/**
 * Сумма из поля ввода → минимальные единицы валюты: «1 500,50», «1500.5», «-10», «,5».
 * Больше знаков после запятой, чем у валюты, — null (округление появится вместе с калькулятором суммы на шаге 6).
 */
export function parseAmount(text: string, minorUnits: number): number | null {
  const s = text.replace(/[\s\u00A0\u202F]/g, '').replace('\u2212', '-').replace(',', '.');
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const int = m[2] ?? '';
  const frac = m[3] ?? '';
  if (int === '' && frac === '') return null;
  if (frac.length > minorUnits) return null;
  const value = Number(int + frac.padEnd(minorUnits, '0'));
  if (!Number.isSafeInteger(value)) return null;
  return m[1] === '-' && value !== 0 ? -value : value;
}

/** Минимальные единицы → «1 500,50»: разряды через узкий неразрывный пробел, отрицательные — со знаком минус U+2212. */
export function formatAmount(minor: number, minorUnits: number): string {
  const abs = String(Math.abs(minor)).padStart(minorUnits + 1, '0');
  const int = minorUnits > 0 ? abs.slice(0, -minorUnits) : abs;
  const frac = minorUnits > 0 ? abs.slice(-minorUnits) : '';
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  return `${minor < 0 ? '\u2212' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}
