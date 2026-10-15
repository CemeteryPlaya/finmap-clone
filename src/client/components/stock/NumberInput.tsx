import type { InputHTMLAttributes } from 'react';
import { AMOUNT_MAX_LENGTH, sanitizeAmountInput } from '../../lib/amount-input';

/**
 * Поле суммы, цены или количества склада: принимает только цифры и один разделитель («,» или «.», решение владельца
 * 2026-10-14, `lib/amount-input.ts`). Обычное поле без плавающей подписи: подпись — у `Field` или `aria-label`.
 */
export function NumberInput({ value, onChange, ...rest }: { value: string; onChange: (text: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  return (
    <input
      {...rest}
      inputMode="decimal"
      autoComplete="off"
      maxLength={AMOUNT_MAX_LENGTH}
      value={value}
      onChange={(e) => onChange(sanitizeAmountInput(e.target.value))}
    />
  );
}
