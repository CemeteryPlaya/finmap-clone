import { describe, expect, it } from 'vitest';
import { CALC_ERRORS, evaluateAmount } from '../../src/shared/calc';

const ok = (text: string, minorUnits = 2) => {
  const r = evaluateAmount(text, minorUnits);
  if (!r.ok) throw new Error(`«${text}»: ${r.error}`);
  return r.minor;
};
const err = (text: string, minorUnits = 2) => {
  const r = evaluateAmount(text, minorUnits);
  if (r.ok) throw new Error(`«${text}» вычислилось в ${r.minor}`);
  return r.error;
};

describe('evaluateAmount — калькулятор поля суммы (§7, §10)', () => {
  it('число: запятая и точка, пробелы (и неразрывные) не учитываются', () => {
    expect(ok('1500')).toBe(150000);
    expect(ok('1 500,50')).toBe(150050);
    expect(ok('1500.5')).toBe(150050);
    expect(ok('1\u00A0500')).toBe(150000);
    expect(ok('1\u202F500,5')).toBe(150050);
    expect(ok(',5')).toBe(50);
    expect(ok('7.')).toBe(700);
  });

  it('приоритет операций, скобки, левая ассоциативность', () => {
    expect(ok('2+3*4')).toBe(1400);
    expect(ok('(2+3)*4')).toBe(2000);
    expect(ok('10-2-3')).toBe(500);
    expect(ok('100/4/5')).toBe(500);
    expect(ok('((1+2)*(3+4))')).toBe(2100);
    expect(ok(' 1 500 + 2 500,50 ')).toBe(400050);
  });

  it('знаки операций с кнопок и клавиатуры: × ÷ \u2212 и : * -', () => {
    expect(ok('10×3')).toBe(3000);
    expect(ok('10÷4')).toBe(250);
    expect(ok('10\u22123')).toBe(700);
    expect(ok('10:4')).toBe(250);
    expect(ok('10*3-5')).toBe(2500);
  });

  it('унарный минус и плюс; отрицательный результат — не ошибка калькулятора (проверяет форма)', () => {
    expect(ok('-5+10')).toBe(500);
    expect(ok('+5')).toBe(500);
    expect(ok('-(2+3)')).toBe(-500);
    expect(ok('2*-3')).toBe(-600);
    expect(ok('0')).toBe(0);
  });

  it('округление half-up до минимальных единиц валюты (0, 2 и 3 знака)', () => {
    expect(ok('10/3')).toBe(333);
    expect(ok('20/3')).toBe(667);
    expect(ok('0,005')).toBe(1);
    expect(ok('0,0049')).toBe(0);
    expect(ok('-0,005')).toBe(-1);
    expect(ok('10/4', 0)).toBe(3); // 2,5 JPY → 3
    expect(ok('1/3', 3)).toBe(333);
    expect(ok('1/3*3')).toBe(100); // 0,99999999999999999999 → 1,00
    // больше 20 знаков после запятой — округление, а не ошибка
    expect(ok('1,999999999999999999995')).toBe(200);
    expect(ok('0,1234567890123456789012345', 3)).toBe(123);
  });

  it('деление на ноль — ошибка (§10)', () => {
    expect(err('5/0')).toBe(CALC_ERRORS.divZero);
    expect(err('5/(2-2)')).toBe(CALC_ERRORS.divZero);
    expect(err('5÷0,0')).toBe(CALC_ERRORS.divZero);
  });

  it('пустое поле и неверные выражения', () => {
    expect(err('')).toBe(CALC_ERRORS.empty);
    expect(err('   ')).toBe(CALC_ERRORS.empty);
    for (const bad of ['2+', '(2', '2)', 'abc', '1,2,3', '2**3', '1e3', '()', '2(3)', '.', '5%']) {
      expect(err(bad), bad).toBe(CALC_ERRORS.syntax);
    }
    expect(err(`1+${'1'.repeat(200)}`)).toBe(CALC_ERRORS.syntax);
  });

  it('слишком большая сумма — ошибка, а не потеря точности', () => {
    expect(ok('90071992547409,91')).toBe(9007199254740991);
    expect(err('90071992547409,92')).toBe(CALC_ERRORS.tooBig);
    expect(err('99999999999999*99999999999999')).toBe(CALC_ERRORS.tooBig);
  });
});
