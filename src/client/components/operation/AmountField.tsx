import { useEffect, useRef, useState } from 'react';
import { useAutoFocus } from '../useAutoFocus';
import { isCoarsePointer, refocusTarget } from '../focus-trap';
import { AMOUNT_MAX_LENGTH, sanitizeAmountInput } from '../../lib/amount-input';
import { positiveAmount } from '../../lib/operation-form';
import { amountInputText } from '../../lib/journal-format';
import { Field } from '../Field';
import { floatingControlBase } from '../ui';

/**
 * Поле суммы (§7): принимает только цифры и один разделитель («,» или «.»; решение владельца 2026-10-14). При уходе
 * из поля число приводится к виду `amountInputText`; ошибка (лишние знаки, ноль) показывается у поля.
 */
export function AmountField(props: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  minorUnits: number;
  error?: string;
  hint?: string;
  disabled?: boolean;
  /** Поставить фокус в поле при появлении, если он ничей (страница, окно, «×», элемент, сфокусированный окном при открытии); иначе не трогать. */
  autoFocus?: boolean;
  /** Поставить фокус в поле при каждом изменении значения (после «Добавить и создать похожий»). */
  refocusSignal?: number;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  // фокус в поле при появлении, если он «ничей» (окно только что открылось) — useAutoFocus
  useAutoFocus(ref, props.autoFocus);

  // явный возврат фокуса («Добавить и создать похожий», «Дублировать платёж»): один раз, когда новое состояние уже в DOM.
  // На устройстве с пальцем — на «×» окна: фокус в поле поднял бы экранную клавиатуру (refocusTarget)
  useEffect(() => {
    if (!props.refocusSignal) return;
    if (refocusTarget(isCoarsePointer()) === 'field') ref.current?.focus();
    else ref.current?.closest('dialog')?.querySelector<HTMLElement>('[data-modal-close]')?.focus({ preventScroll: true });
  }, [props.refocusSignal]);

  /** Привести число поля к виду `amountInputText`; true — поле пусто или верно, false — ошибка показана у поля. */
  const normalize = (): boolean => {
    if (props.value.trim() === '') return true;
    const r = positiveAmount(props.value, props.minorUnits);
    if (r.ok) {
      // то же значение не пересылаем: форма по любому изменению убирает «Это копия…», и кнопка сдвинулась бы между нажатием и отпусканием
      const text = amountInputText(r.minor, props.minorUnits);
      if (text !== props.value) props.onChange(text);
    }
    setFieldError(r.ok ? null : r.error);
    return r.ok;
  };

  return (
    <Field
      label={props.label}
      error={props.error ?? fieldError ?? undefined}
      hint={props.hint}
      className={props.className}
      floating
      filled={props.value !== ''}
    >
      {(c) => (
        <input
          {...c}
          ref={ref}
          inputMode="decimal"
          autoComplete="off"
          maxLength={AMOUNT_MAX_LENGTH}
          disabled={props.disabled}
          value={props.value}
          onChange={(e) => {
            props.onChange(sanitizeAmountInput(e.target.value));
            setFieldError(null);
          }}
          onBlur={normalize}
          // сумма — крупная, как раньше (text-lg): размер — отдельно от floatingControlBase
          className={`${floatingControlBase} text-lg font-semibold tabular-nums`}
        />
      )}
    </Field>
  );
}
