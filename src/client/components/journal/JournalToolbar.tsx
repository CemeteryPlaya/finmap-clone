import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { clearFilter, isFiltered, journalApiParams, panelConditionCount, SEARCH_MAX, SORT_CHOICES, type JournalUrlState } from '../../lib/journal-filter';
import { Drawer } from '../Drawer';
import { Field } from '../Field';
import { SearchIcon } from '../icons';
import { btnSmall, inputClass } from '../ui';
import { AmountRange } from './AmountRange';
import { MoreMenu } from './MoreMenu';
import { PeriodMenu } from './PeriodMenu';

/** Пауза поиска: запрос уходит, когда пользователь перестал печатать. */
export const SEARCH_DEBOUNCE_MS = 300;

const compactInput = inputClass.replace('py-3', 'py-2');
const searchInput = compactInput.replace('px-4', 'pl-10 pr-4');
const squareButton = 'grid size-10 shrink-0 place-items-center rounded-xl bg-field text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Поиск (§5.1 этапа 1.5): лупа внутри поля, справа кнопка-лупа «Найти» (применяет сразу); живой поиск через
 * паузу и по Enter остаётся. Подписи над полем нет — доступное имя «Поиск».
 */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
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
          placeholder="Поиск по счетам, контрагентам, комментариям"
          onChange={(e) => setText(e.target.value)}
          className={searchInput}
        />
      </div>
      <button type="submit" aria-label="Найти" title="Найти" className={squareButton}>
        <SearchIcon />
      </button>
    </form>
  );
}

/**
 * Тулбар журнала (§5.1 этапа 1.5) — одна строка без подписей над полями: пилюля периода, поиск,
 * «Фильтр · N | ▾» (её собирает страница: окно фильтра и сохранённые фильтры), ✕ «Сбросить фильтр», если что-то
 * задано, и «Ещё ▾» (сумма, ⟳, колонки, выгрузка).
 * На телефоне (`mobile`, до плана 1.5-5) на виду только поиск и кнопка «Фильтры · N»: период, сумма, сортировка
 * (у карточек нет заголовков колонок), «Фильтр | ▾», выгрузка и сброс — в панели, выезжающей справа.
 */
export function JournalToolbar(props: {
  state: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  companyId: number;
  baseCurrency: string;
  today: string;
  /** «Фильтр · N | ▾». */
  filter: ReactNode;
  /** ⟳ в «Ещё»: журнал, балансы и компании перечитываются (§2.5). */
  onRefresh: () => Promise<void>;
  /** Сбой сохранения колонок или «Показывать полностью» после закрытия «Ещё». */
  onPrefError?: (text: string) => void;
  mobile?: boolean;
}) {
  const { state, onChange } = props;
  const currency = getCurrency(props.baseCurrency);
  const exportHref = `/api/v1/companies/${props.companyId}/operations/export.xlsx?${journalApiParams(state, props.today).toString()}`;
  // сброс пересоздаёт поиск и суммы: набранный, но не применённый текст (запрос, неверная сумма) не переживёт сброс
  const [resetKey, setResetKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  // окно стало шире телефона — панели нет, всё снова в тулбаре
  useEffect(() => {
    if (!props.mobile) setPanelOpen(false);
  }, [props.mobile]);

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
  const period = <PeriodMenu state={state} today={props.today} onChange={onChange} />;
  const search = <SearchBox key={resetKey} value={state.q ?? ''} onSearch={setQuery} />;

  if (props.mobile) {
    const count = panelConditionCount(state);
    return (
      <div className="mb-4 flex items-center gap-2">
        {search}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen(true)}
          className={`${btnSmall} shrink-0 py-2.5`}
        >
          Период и условия{count > 0 && ` · ${count}`}
        </button>
        {/* до плана 1.5-5; имя кнопки совпадает с названием панели */}
        <Drawer open={panelOpen} title="Период и условия" side="right" onClose={() => setPanelOpen(false)}>
          <div className="flex flex-col gap-4">
            <div>{period}</div>
            <div>
              <p className="mb-1 text-sm text-muted">Сумма, {currency.symbol}</p>
              <AmountRange key={resetKey} state={state} onChange={onChange} minorUnits={currency.minorUnits} />
            </div>
            <Field label="Сортировка" className="w-48">
              {(c) => (
                <select
                  {...c}
                  value={`${state.sort}:${state.order}`}
                  onChange={(e) => {
                    const choice = SORT_CHOICES.find((s) => `${s.sort}:${s.order}` === e.target.value);
                    if (choice) onChange({ ...state, sort: choice.sort, order: choice.order });
                  }}
                  className={compactInput}
                >
                  {SORT_CHOICES.map((s) => (
                    <option key={`${s.sort}:${s.order}`} value={`${s.sort}:${s.order}`}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              {props.filter}
              <a href={exportHref} download className={btnSmall}>
                Выгрузить в Excel
              </a>
              {isFiltered(state) && (
                <button type="button" onClick={reset} className={btnSmall}>
                  Сбросить фильтр
                </button>
              )}
            </div>
          </div>
        </Drawer>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {period}
      {search}
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
        exportHref={exportHref}
        onRefresh={props.onRefresh}
        onPrefError={props.onPrefError}
      />
    </div>
  );
}
