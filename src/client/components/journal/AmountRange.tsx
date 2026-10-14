import { useEffect, useId, useRef, useState } from 'react';
import { parseAmount } from '../../../shared/money';
import type { JournalUrlState } from '../../lib/journal-filter';
import { AMOUNT_MAX_LENGTH, sanitizeAmountInput } from '../../lib/amount-input';
import { amountInputText } from '../../lib/journal-format';
import { inputClass } from '../ui';

const amountInput = `${inputClass.replace('py-3', 'py-2').replace('px-4', 'px-3')} text-sm`;

function AmountInput(props: { label: string; placeholder: string; value: number | undefined; minorUnits: number; onCommit: (v: number | undefined) => void }) {
  const shown = props.value === undefined ? '' : amountInputText(props.value, props.minorUnits);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | undefined>();
  const errorId = useId();

  // значение сменилось снаружи (сброс, другая граница) — показываем его
  useEffect(() => {
    setText(shown);
    setError(undefined);
  }, [shown]);

  // Esc отменяет набранное, как в окне «Фильтр»: blur при возврате фокуса на кнопку и закрытие панели ничего не применяют.
  // Сбрасывается следующим вводом
  const discarded = useRef(false);

  const commit = () => {
    if (discarded.current) {
      setText(shown);
      setError(undefined);
      return;
    }
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
  // панель «Ещё» закрыли щелчком мимо: поле исчезает раньше, чем браузер пришлёт blur, — набранное применяется здесь.
  // Только пока путь страницы тот же, что при появлении поля: после перехода (ссылка «Настройки журнала», «Назад»
  // браузера, смена компании) правка фильтра увела бы уже другую страницу обратно в журнал
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const pathAtMount = useRef(window.location.pathname);
  useEffect(
    () => () => {
      if (window.location.pathname === pathAtMount.current) commitRef.current();
    },
    [],
  );

  return (
    <div className="w-28">
      <input
        aria-label={props.label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        inputMode="decimal"
        maxLength={AMOUNT_MAX_LENGTH}
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => {
          discarded.current = false;
          setText(sanitizeAmountInput(e.target.value));
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          // без preventDefault: Esc дальше закрывает панель
          if (e.key === 'Escape') {
            discarded.current = true;
            setText(shown);
            setError(undefined);
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className={amountInput}
      />
      {error && (
        <span id={errorId} className="mt-1 block text-xs text-expense-strong">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * «Сумма от / до» (§5.1 этапа 1.5) в минимальных единицах базовой валюты. Применяется по Enter, уходу из поля
 * и при закрытии панели, в которой стоят поля (Review Focus 3). Видимой подписи у полей нет — только «От» и «По»
 * в самих полях; доступные имена «Сумма от» и «Сумма до».
 */
export function AmountRange(props: { state: JournalUrlState; onChange: (next: JournalUrlState) => void; minorUnits: number }) {
  const set = (key: 'amountMin' | 'amountMax') => (v: number | undefined) => {
    const next = { ...props.state };
    if (v === undefined) delete next[key];
    else next[key] = v;
    props.onChange(next);
  };
  return (
    <div className="flex items-start gap-2">
      <AmountInput label="Сумма от" placeholder="От" value={props.state.amountMin} minorUnits={props.minorUnits} onCommit={set('amountMin')} />
      <AmountInput label="Сумма до" placeholder="По" value={props.state.amountMax} minorUnits={props.minorUnits} onCommit={set('amountMax')} />
    </div>
  );
}
