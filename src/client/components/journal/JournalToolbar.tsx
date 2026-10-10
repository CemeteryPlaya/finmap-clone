import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { parseAmount } from '../../../shared/money';
import { clearFilter, isFiltered, journalApiParams, panelConditionCount, SEARCH_MAX, SORT_CHOICES, type JournalUrlState } from '../../lib/journal-filter';
import { amountInputText } from '../../lib/journal-format';
import { Drawer } from '../Drawer';
import { Field } from '../Field';
import { btnSmall, inputClass } from '../ui';
import { PeriodMenu } from './PeriodMenu';

/** Пауза поиска: запрос уходит, когда пользователь перестал печатать. */
export const SEARCH_DEBOUNCE_MS = 300;

const compactInput = inputClass.replace('py-3', 'py-2');

type OptionalKey = 'q' | 'amountMin' | 'amountMax';

/** Фильтр без необязательных полей keys. */
function omit(state: JournalUrlState, ...keys: OptionalKey[]): JournalUrlState {
  const next = { ...state };
  for (const k of keys) delete next[k];
  return next;
}

function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  // последнее значение, которое ушло в адресную строку: отличает внешнюю смену (сброс) от своей
  const sent = useRef(value);
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
    return () => clearTimeout(t);
  }, [text]);

  return (
    <form
      role="search"
      className="min-w-48 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        sent.current = q;
        onSearchRef.current(q);
      }}
    >
      <Field label="Поиск">
        {(c) => (
          <input
            {...c}
            type="search"
            value={text}
            maxLength={SEARCH_MAX}
            placeholder="Комментарий, контрагент, счёт, категория, проект"
            onChange={(e) => setText(e.target.value)}
            className={compactInput}
          />
        )}
      </Field>
    </form>
  );
}

function AmountInput(props: { label: string; value: number | undefined; minorUnits: number; onCommit: (v: number | undefined) => void }) {
  const shown = props.value === undefined ? '' : amountInputText(props.value, props.minorUnits);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | undefined>();

  // значение сменилось снаружи (сброс, другая граница) — показываем его
  useEffect(() => {
    setText(shown);
    setError(undefined);
  }, [shown]);

  const commit = () => {
    const t = text.trim();
    if (t === '') {
      setError(undefined);
      if (props.value !== undefined) props.onCommit(undefined);
      return;
    }
    const minor = parseAmount(t, props.minorUnits);
    if (minor === null) return setError('Введите сумму');
    if (minor < 0) return setError('Сумма не меньше нуля');
    setError(undefined);
    if (minor !== props.value) props.onCommit(minor);
  };

  return (
    <Field label={props.label} error={error} className="w-32">
      {(c) => (
        <input
          {...c}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          className={compactInput}
        />
      )}
    </Field>
  );
}

/**
 * Тулбар журнала (§5.1 этапа 1.5): пилюля периода, поиск, сумма от/до в базовой валюте, выгрузка в Excel по
 * текущему фильтру, сброс. actions — кнопки окна «Фильтр», сохранённых фильтров и колонок.
 * На телефоне (`mobile`) на виду только поиск и кнопка «Фильтры · N»: остальное, а также сортировка (у карточек
 * нет заголовков колонок) — в панели, выезжающей справа.
 */
export function JournalToolbar(props: {
  state: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  companyId: number;
  baseCurrency: string;
  today: string;
  actions?: ReactNode;
  mobile?: boolean;
}) {
  const { state, onChange } = props;
  const currency = getCurrency(props.baseCurrency);
  const exportHref = `/api/v1/companies/${props.companyId}/operations/export.xlsx?${journalApiParams(state, props.today).toString()}`;
  const setAmount = (key: 'amountMin' | 'amountMax') => (v: number | undefined) => onChange(v === undefined ? omit(state, key) : { ...state, [key]: v });
  // сброс пересоздаёт поиск и суммы: набранный, но не применённый текст (запрос, неверная сумма) не переживёт сброс
  const [searchKey, setSearchKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  // окно стало шире телефона — панели нет, всё снова в тулбаре
  useEffect(() => {
    if (!props.mobile) setPanelOpen(false);
  }, [props.mobile]);

  const period = <PeriodMenu state={state} today={props.today} onChange={onChange} />;
  const search = <SearchBox key={searchKey} value={state.q ?? ''} onSearch={(q) => onChange(q ? { ...state, q } : omit(state, 'q'))} />;
  const amounts = (
    <>
      <AmountInput key={`min-${searchKey}`} label={`Сумма от, ${currency.symbol}`} value={state.amountMin} minorUnits={currency.minorUnits} onCommit={setAmount('amountMin')} />
      <AmountInput key={`max-${searchKey}`} label={`Сумма до, ${currency.symbol}`} value={state.amountMax} minorUnits={currency.minorUnits} onCommit={setAmount('amountMax')} />
    </>
  );
  const buttons = (
    <div className="flex flex-wrap items-center gap-2">
      {props.actions}
      <a href={exportHref} download className={btnSmall}>
        Выгрузить в Excel
      </a>
      {isFiltered(state) && (
        <button
          type="button"
          onClick={() => {
            setSearchKey((k) => k + 1);
            onChange(clearFilter(state));
          }}
          className={btnSmall}
        >
          Сбросить фильтр
        </button>
      )}
    </div>
  );

  if (props.mobile) {
    const count = panelConditionCount(state);
    return (
      <div className="mb-4 flex items-end gap-2">
        {search}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen(true)}
          className={`${btnSmall} shrink-0 py-2.5`}
        >
          Фильтры{count > 0 && ` · ${count}`}
        </button>
        <Drawer open={panelOpen} title="Фильтры" side="right" onClose={() => setPanelOpen(false)}>
          <div className="flex flex-col gap-3">
            <div>{period}</div>
            <div className="flex flex-wrap gap-3">{amounts}</div>
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
            {buttons}
          </div>
        </Drawer>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {period}
        {search}
        {amounts}
      </div>
      {buttons}
    </div>
  );
}
