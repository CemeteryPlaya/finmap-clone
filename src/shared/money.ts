import { getCurrency } from './currencies';

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

/**
 * Распределение целого total на части пропорционально весам (§4.1): каждая часть округляется вниз,
 * недостающие единицы получают части с наибольшими дробными остатками, при равенстве — по порядку.
 * Сумма частей всегда равна total. Веса — положительные целые, total ≥ 0.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('allocate: сумма должна быть неотрицательным целым');
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) throw new Error('allocate: веса должны быть неотрицательными целыми');
  const sum = weights.reduce((s, w) => s + BigInt(w), 0n);
  if (weights.length === 0 || sum <= 0n) throw new Error('allocate: нужны положительные веса');
  const t = BigInt(total);
  const parts = weights.map((w) => (t * BigInt(w)) / sum);
  const rest = weights.map((w, i) => ({ i, r: (t * BigInt(w)) % sum }));
  let left = Number(t - parts.reduce((s, p) => s + p, 0n));
  rest.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of rest) {
    if (left <= 0) break;
    parts[i]! += 1n;
    left--;
  }
  return parts.map((p) => Number(p));
}

/** Как показывать сумму на экране (§2.2 этапа 1.5). */
export interface MoneyFormat {
  /** Символ валюты перед суммой («₸ 114 997») или после («114 997 ₸», по умолчанию). */
  symbol?: 'before' | 'after';
  /** Нулевые копейки не показывать: «1 500 ₸», но «1 500,50 ₸». */
  trimZeroMinor?: boolean;
}

/** Журнал, карточки, форма, подсказки разбиения: символ после суммы, без нулевых копеек. */
export const MONEY_SCREEN: MoneyFormat = { trimZeroMinor: true };
/** Левая панель, итоги компаний, история действий: «₸ 114 997», «\u2212₸ 1 378». */
export const MONEY_SCREEN_BEFORE: MoneyFormat = { symbol: 'before', trimZeroMinor: true };

/**
 * Сумма с символом валюты: «1 500,50 ₸» — неразрывный пробел не даёт символу уехать на другую строку.
 * Минус (U+2212) всегда в самом начале: «\u22121 378 ₸», «\u2212₸ 1 378». Поля ввода и Excel эту функцию не используют.
 */
export function formatMoney(minor: number, currency: string, opts: MoneyFormat = {}): string {
  const c = getCurrency(currency);
  let amount = formatAmount(Math.abs(minor), c.minorUnits);
  if (opts.trimZeroMinor && c.minorUnits > 0 && Math.abs(minor) % 10 ** c.minorUnits === 0) {
    amount = amount.slice(0, -(c.minorUnits + 1));
  }
  const sign = minor < 0 ? '\u2212' : '';
  return opts.symbol === 'before' ? `${sign}${c.symbol}\u00A0${amount}` : `${sign}${amount}\u00A0${c.symbol}`;
}
