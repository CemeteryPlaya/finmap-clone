import { DEC_ONE, divDec, type Dec } from './decimal';

/**
 * Калькулятор поля суммы (§7 «Поле суммы»): `+ - × /` (также `-`, `*`, `÷`, `:`), скобки, унарный минус;
 * десятичный разделитель — запятая или точка; пробелы (в том числе неразрывные) не учитываются.
 * Арифметика — `Dec` из decimal.ts (решение §4.3: вместо big.js): 20 знаков после запятой, умножение и деление
 * округляются half-up на 20-м знаке; результат — half-up (от нуля) до минимальных единиц валюты.
 */
export type CalcResult = { ok: true; minor: number } | { ok: false; error: string };

export const CALC_ERRORS = {
  empty: 'Введите сумму',
  syntax: 'Не удалось вычислить — проверьте выражение',
  divZero: 'Деление на ноль',
  tooBig: 'Слишком большая сумма',
} as const;

/** Длиннее — ошибка: заодно ограничивает глубину скобок. */
export const CALC_MAX_LENGTH = 200;

type Op = '+' | '-' | '*' | '/';
type Token = { kind: 'num'; value: Dec } | { kind: 'op'; value: Op } | { kind: '(' } | { kind: ')' };

const OPS: Record<string, Op> = {
  '+': '+',
  '-': '-',
  '\u2212': '-',
  '*': '*',
  '×': '*',
  '/': '/',
  '÷': '/',
  ':': '/',
};

class CalcError extends Error {
  constructor(readonly reason: keyof typeof CALC_ERRORS) {
    super(reason);
  }
}

const SCALE_DIGITS = 20;

function tokenize(text: string): Token[] {
  const s = text.replace(/\s/g, '');
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    const op = OPS[ch];
    if (op) {
      tokens.push({ kind: 'op', value: op });
      i++;
    } else if (ch === '(' || ch === ')') {
      tokens.push({ kind: ch });
      i++;
    } else {
      const m = /^(\d*)(?:[.,](\d*))?/.exec(s.slice(i))!;
      const int = m[1] ?? '';
      const frac = m[2] ?? '';
      if (int === '' && frac === '') throw new CalcError('syntax');
      // больше 20 знаков после запятой — half-up на 20-м знаке, как в умножении и делении
      const extra = frac.length > SCALE_DIGITS && frac.charCodeAt(SCALE_DIGITS) >= 53 ? 1n : 0n;
      const value = BigInt(int || '0') * DEC_ONE + BigInt(frac.slice(0, SCALE_DIGITS).padEnd(SCALE_DIGITS, '0')) + extra;
      tokens.push({ kind: 'num', value });
      i += m[0].length;
    }
  }
  return tokens;
}

const abs = (d: Dec): Dec => (d < 0n ? -d : d);
const withSign = (negative: boolean, d: Dec): Dec => (negative ? -d : d);

/** a × b, half-up (от нуля) на 20-м знаке. */
function mul(a: Dec, b: Dec): Dec {
  const q = (2n * abs(a) * abs(b) + DEC_ONE) / (2n * DEC_ONE);
  return withSign(a < 0n !== b < 0n, q);
}

/** a / b, half-up (от нуля) на 20-м знаке; деление на ноль — ошибка. */
function div(a: Dec, b: Dec): Dec {
  if (b === 0n) throw new CalcError('divZero');
  return withSign(a < 0n !== b < 0n, divDec(abs(a), abs(b)));
}

/** Рекурсивный спуск: expr := term (± term)*; term := factor (×/ factor)*; factor := ±factor | число | (expr). */
function parse(tokens: Token[]): Dec {
  let pos = 0;
  const peek = () => tokens[pos];

  function factor(): Dec {
    const t = peek();
    if (!t) throw new CalcError('syntax');
    if (t.kind === 'op' && (t.value === '+' || t.value === '-')) {
      pos++;
      const v = factor();
      return t.value === '-' ? -v : v;
    }
    if (t.kind === 'num') {
      pos++;
      return t.value;
    }
    if (t.kind === '(') {
      pos++;
      const v = expr();
      if (peek()?.kind !== ')') throw new CalcError('syntax');
      pos++;
      return v;
    }
    throw new CalcError('syntax');
  }

  function term(): Dec {
    let v = factor();
    for (let t = peek(); t?.kind === 'op' && (t.value === '*' || t.value === '/'); t = peek()) {
      pos++;
      const rhs = factor();
      v = t.value === '*' ? mul(v, rhs) : div(v, rhs);
    }
    return v;
  }

  function expr(): Dec {
    let v = term();
    for (let t = peek(); t?.kind === 'op' && (t.value === '+' || t.value === '-'); t = peek()) {
      pos++;
      const rhs = term();
      v = t.value === '+' ? v + rhs : v - rhs;
    }
    return v;
  }

  const value = expr();
  if (pos !== tokens.length) throw new CalcError('syntax');
  return value;
}

/** Dec → минимальные единицы валюты: half-up, половина — от нуля. */
function toMinor(d: Dec, minorUnits: number): number {
  const scale = 10n ** BigInt(SCALE_DIGITS - minorUnits);
  const q = (2n * abs(d) + scale) / (2n * scale);
  const minor = Number(withSign(d < 0n, q));
  if (!Number.isSafeInteger(minor)) throw new CalcError('tooBig');
  return minor === 0 ? 0 : minor;
}

/**
 * Выражение из поля суммы → минимальные единицы валюты. Знак не проверяется: «сумма больше нуля» — правило формы.
 * «1 500,50» → 150050; «(100+50)*2» → 30000; «10/3» → 333; «5/0» — «Деление на ноль».
 */
export function evaluateAmount(text: string, minorUnits: number): CalcResult {
  if (text.trim() === '') return { ok: false, error: CALC_ERRORS.empty };
  if (text.length > CALC_MAX_LENGTH) return { ok: false, error: CALC_ERRORS.syntax };
  try {
    return { ok: true, minor: toMinor(parse(tokenize(text)), minorUnits) };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: CALC_ERRORS[e.reason] };
    throw e;
  }
}
