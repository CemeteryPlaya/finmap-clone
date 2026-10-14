import { parseAmount } from '../../shared/money';

/** Длина поля суммы: хватает на «-999 999 999 999,9999» без пробелов. */
export const AMOUNT_MAX_LENGTH = 24;

/** Текст поля суммы → только цифры и один разделитель («,» или «.»); с `negative` — ещё «-» в начале. */
export function sanitizeAmountInput(text: string, opts?: { negative?: boolean }): string {
  let out = '';
  let separator = false;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if ((ch === ',' || ch === '.') && !separator) {
      separator = true;
      out += ch;
    } else if ((ch === '-' || ch === '\u2212') && opts?.negative && out === '') out = '-';
  }
  return out;
}

export type AmountParse = { ok: true; minor: number } | { ok: false; error: string };

/** Текст поля суммы → минимальные единицы валюты или понятная ошибка (знак не проверяется). */
export function parseAmountText(text: string, minorUnits: number): AmountParse {
  if (text.trim() === '') return { ok: false, error: 'Введите сумму' };
  const minor = parseAmount(text, minorUnits);
  if (minor === null) return { ok: false, error: `Введите сумму, например ${minorUnits > 0 ? '1 500,50' : '1 500'}` };
  return { ok: true, minor };
}
