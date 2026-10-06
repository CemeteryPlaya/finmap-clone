/**
 * Десятичные курсы без потери точности (§4.1, §4.3): bigint, хранящий значение × 10^20.
 * Промежуточных округлений нет; half-up — только на 20-м знаке деления и при переводе в минимальные единицы.
 */
export type Dec = bigint;

const SCALE = 20;
export const DEC_ONE: Dec = 10n ** BigInt(SCALE);

/** «475,12» / «1.5» → Dec. null — не неотрицательное число или больше maxFraction знаков после запятой. */
export function parseDecimal(text: string, maxFraction = 10): Dec | null {
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(text.trim());
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > maxFraction) return null;
  return BigInt(m[1]!) * DEC_ONE + BigInt(frac.padEnd(SCALE, '0'));
}

/** Dec → «475.12» (без лишних нулей). */
export function decToString(d: Dec): string {
  const neg = d < 0n;
  const abs = neg ? -d : d;
  const int = abs / DEC_ONE;
  const frac = (abs % DEC_ONE).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** a / b с округлением half-up на 20-м знаке (a ≥ 0, b > 0). */
export function divDec(a: Dec, b: Dec): Dec {
  if (b <= 0n || a < 0n) throw new Error('divDec: ожидаются a ≥ 0, b > 0');
  return (2n * a * DEC_ONE + b) / (2n * b);
}

/** Курс для показа: half-up до `digits` значащих цифр (§4.3: в operations.rate — 10). */
export function roundSignificant(d: Dec, digits = 10): string {
  if (d <= 0n) return decToString(d);
  const len = d.toString().length;
  if (len <= digits) return decToString(d);
  const drop = 10n ** BigInt(len - digits);
  const q = d / drop;
  const r = d % drop;
  return decToString((2n * r >= drop ? q + 1n : q) * drop);
}

/**
 * Сумма в минимальных единицах валюты X → минимальные единицы валюты B по курсу (Dec за 1 единицу X):
 * round_half_up(amount / 10^fromMinor × rate × 10^toMinor), половина — от нуля, знак сохраняется.
 */
export function convertMinor(amount: number, rate: Dec, fromMinor: number, toMinor: number): number {
  const neg = amount < 0;
  const n = BigInt(Math.abs(amount)) * rate * 10n ** BigInt(toMinor);
  const den = 10n ** BigInt(fromMinor) * DEC_ONE;
  const result = Number((2n * n + den) / (2n * den));
  return neg && result !== 0 ? -result : result;
}
