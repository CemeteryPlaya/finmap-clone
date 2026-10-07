import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { isValidDate } from '../../../shared/dates';
import { parseAmount } from '../../../shared/money';
import { clearFilter, isFiltered, journalApiParams, PERIODS, periodRange, SEARCH_MAX, type JournalUrlState, type PeriodKey } from '../../lib/journal-filter';
import { amountInputText } from '../../lib/journal-format';
import { Field } from '../Field';
import { btnSmall, inputClass } from '../ui';

/** Пауза поиска: запрос уходит, когда пользователь перестал печатать. */
export const SEARCH_DEBOUNCE_MS = 300;

const compactInput = inputClass.replace('py-3', 'py-2');

type OptionalKey = 'from' | 'to' | 'q' | 'amountMin' | 'amountMax';

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
            placeholder="Комментарий, контрагент, счёт, статья, проект"
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
 * Граница периода. Дата применяется по уходу из поля или Enter, а не на каждое изменение: пока год набирают
 * по цифре, промежуточные даты («0002-…») не уходят в адрес и не меняют границы местами.
 */
function DateInput(props: { label: string; value: string | undefined; onCommit: (value: string) => void }) {
  const [text, setText] = useState(props.value ?? '');
  useEffect(() => setText(props.value ?? ''), [props.value]);
  const commit = () => {
    if (text === (props.value ?? '')) return;
    if (text === '' || isValidDate(text)) props.onCommit(text);
  };
  return (
    <Field label={props.label} className="w-40">
      {(c) => (
        <input
          {...c}
          type="date"
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

function PeriodPicker({ state, today, onChange }: { state: JournalUrlState; today: string; onChange: (next: JournalUrlState) => void }) {
  const choose = (period: PeriodKey) => {
    // «Произвольно» начинается с границ выбранного сейчас периода — их удобно поправить
    if (period === 'custom') onChange({ ...omit(state, 'from', 'to'), period, ...periodRange(state, today) });
    else onChange({ ...omit(state, 'from', 'to'), period });
  };
  const setBound = (key: 'from' | 'to', value: string) => {
    onChange(value ? { ...state, period: 'custom', [key]: value } : { ...omit(state, key), period: 'custom' });
  };
  return (
    <>
      <Field label="Период" className="w-48">
        {(c) => (
          <select {...c} value={state.period} onChange={(e) => choose(e.target.value as PeriodKey)} className={compactInput}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {state.period === 'custom' && (
        <>
          <DateInput label="С" value={state.from} onCommit={(v) => setBound('from', v)} />
          <DateInput label="По" value={state.to} onCommit={(v) => setBound('to', v)} />
        </>
      )}
    </>
  );
}

/**
 * Тулбар журнала (§7): период, поиск, сумма от/до в базовой валюте, выгрузка в Excel по текущему фильтру, сброс.
 * actions — кнопки модалки «Фильтр», сохранённых фильтров и колонок (их добавляют следующие задачи).
 */
export function JournalToolbar(props: {
  state: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  companyId: number;
  baseCurrency: string;
  today: string;
  actions?: ReactNode;
}) {
  const { state, onChange } = props;
  const currency = getCurrency(props.baseCurrency);
  const exportHref = `/api/v1/companies/${props.companyId}/operations/export.xlsx?${journalApiParams(state, props.today).toString()}`;
  const setAmount = (key: 'amountMin' | 'amountMax') => (v: number | undefined) => onChange(v === undefined ? omit(state, key) : { ...state, [key]: v });
  // сброс пересоздаёт поиск и суммы: набранный, но не применённый текст (запрос, неверная сумма) не переживёт сброс
  const [searchKey, setSearchKey] = useState(0);

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <PeriodPicker state={state} today={props.today} onChange={onChange} />
        <SearchBox key={searchKey} value={state.q ?? ''} onSearch={(q) => onChange(q ? { ...state, q } : omit(state, 'q'))} />
        <AmountInput key={`min-${searchKey}`} label={`Сумма от, ${currency.symbol}`} value={state.amountMin} minorUnits={currency.minorUnits} onCommit={setAmount('amountMin')} />
        <AmountInput key={`max-${searchKey}`} label={`Сумма до, ${currency.symbol}`} value={state.amountMax} minorUnits={currency.minorUnits} onCommit={setAmount('amountMax')} />
      </div>
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
    </div>
  );
}
