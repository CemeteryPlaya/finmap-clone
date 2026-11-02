import { describe, expect, it } from 'vitest';
import { SenetError } from '../../src/server/modules/senet/source';
import { localToUtc } from '../../src/server/modules/senet/time';
import { parseReport } from '../../src/server/modules/senet/xlsx-reports';
import { SENET_HEADERS, senetSample, TWO_SHIFTS, xlTime } from '../helpers/senet-samples';

const TZ = 'Asia/Almaty';

/** Разбор отчётов админ-панели Senet (план 2026-11-02-senet-autopost, задача 4). */
describe('localToUtc', () => {
  it('строка и число Excel дают один момент UTC (Алматы — UTC+5), миллисекунды сохраняются', () => {
    expect(localToUtc('2026-10-01 10:26:45', TZ)).toBe('2026-10-01T05:26:45.000Z');
    const serial = (xlTime('2026-10-01 10:26:45') as { value: number }).value;
    expect(localToUtc(serial, TZ)).toBe('2026-10-01T05:26:45.000Z');
    expect(localToUtc((xlTime('2026-10-01 00:05:29.32') as { value: number }).value, TZ)).toBe('2026-09-30T19:05:29.320Z');
    expect(localToUtc('2026-10-01 00:05:29.32', TZ)).toBe('2026-09-30T19:05:29.320Z');
  });
});

describe('parseReport', () => {
  it('sessions: открытая смена — closedAt null; суммы в тиынах; имя офиса', () => {
    const data = senetSample('sessions', [...TWO_SHIFTS, ['Клуб 1', 'Клуб 1', xlTime('2026-10-02 09:58:10'), 'Сотрудник А', null, null, 3_000, 3_000, 0]]);
    const { rows, officeName } = parseReport('sessions', data, TZ);
    expect(officeName).toBe('Клуб 1');
    expect(rows).toEqual([
      { openedAt: '2026-10-01T05:26:45.000Z', closedAt: '2026-10-01T17:13:46.000Z', openedBy: 'Сотрудник А', closedBy: 'Сотрудник А', endBalance: 1_000_000, cash: 1_000_000, cashless: 0 },
      { openedAt: '2026-10-01T17:14:59.000Z', closedAt: '2026-10-02T04:57:46.000Z', openedBy: 'Сотрудник А', closedBy: 'Сотрудник А', endBalance: 1_200_000, cash: 1_200_000, cashless: 0 },
      { openedAt: '2026-10-02T04:58:10.000Z', closedAt: null, openedBy: 'Сотрудник А', closedBy: null, endBalance: 300_000, cash: 300_000, cashless: 0 },
    ]);
  });

  it('cashMoves: вынос — kind out с положительной суммой; пустой комментарий — пустая строка', () => {
    const data = senetSample('cashMoves', [
      ['Клуб 1', xlTime('2026-10-01 22:10:00.250'), 'Сотрудник А', 'Вынесение', -5000, 'zp Оператор 1'],
      ['Клуб 1', xlTime('2026-10-01 22:15:30'), 'Сотрудник А', 'Внесение средств', 10_000, null],
    ]);
    expect(parseReport('cashMoves', data, TZ).rows).toEqual([
      { at: '2026-10-01T17:10:00.250Z', cashier: 'Сотрудник А', kind: 'out', amount: 500_000, comment: 'zp Оператор 1' },
      { at: '2026-10-01T17:15:30.000Z', cashier: 'Сотрудник А', kind: 'in', amount: 1_000_000, comment: '' },
    ]);
  });

  it('колонки ищутся по заголовку: перестановка колонок не меняет разбор', () => {
    const h = SENET_HEADERS.cashMoves;
    const swapped = [h[5], h[4], h[3], h[2], h[1], h[0]];
    const data = senetSample('cashMoves', [['kaspi', -2000, 'Вынесение', 'Сотрудник А', xlTime('2026-10-01 22:00:00'), 'Клуб 1']], swapped);
    expect(parseReport('cashMoves', data, TZ).rows).toEqual([{ at: '2026-10-01T17:00:00.000Z', cashier: 'Сотрудник А', kind: 'out', amount: 200_000, comment: 'kaspi' }]);
  });

  it('transactions: покупка и возврат; пустой код — пустая строка', () => {
    const data = senetSample('transactions', [
      ['Клуб 1', '30.09.2026-31.10.2026', xlTime('2026-10-01 12:00:00'), 'T1', 'Покупка чека', 1000, 'Наличный расчет'],
      ['Клуб 1', '30.09.2026-31.10.2026', xlTime('2026-10-01 12:30:00'), null, 'Возврат чека', 500, 'Наличный расчет'],
    ]);
    expect(parseReport('transactions', data, TZ).rows).toEqual([
      { at: '2026-10-01T07:00:00.000Z', code: 'T1', kind: 'sell', amount: 100_000, payment: 'Наличный расчет' },
      { at: '2026-10-01T07:30:00.000Z', code: '', kind: 'refund', amount: 50_000, payment: 'Наличный расчет' },
    ]);
  });

  it('soldItems, checks, refills', () => {
    const sold = senetSample('soldItems', [
      [xlTime('2026-10-01 12:00:00'), 'Напиток 1', 2, 1500, 'Наличный расчет', 'Использовано', null],
      [xlTime('2026-10-01 12:05:00'), 'A1B2', null, 1000, 'Наличный расчет', 'Возвраты', 'брак'],
    ]);
    expect(parseReport('soldItems', sold, TZ).rows).toEqual([
      { at: '2026-10-01T07:00:00.000Z', item: 'Напиток 1', qty: 2, amount: 150_000, payment: 'Наличный расчет', refund: false, comment: '' },
      { at: '2026-10-01T07:05:00.000Z', item: 'A1B2', qty: null, amount: 100_000, payment: 'Наличный расчет', refund: true, comment: 'брак' },
    ]);
    const checks = senetSample('checks', [['Клуб 1', 'Клуб 1', 'Сотрудник А', 'C1D2', 'Да', 1000, 7, 'гость1', 77012345612, xlTime('2026-10-01 20:00:00')]]);
    expect(parseReport('checks', checks, TZ).rows).toEqual([
      { at: '2026-10-01T15:00:00.000Z', code: 'C1D2', amount: 100_000, used: true, workstation: 7, guestLogin: 'гость1', phone: '77012345612', cashier: 'Сотрудник А' },
    ]);
    const refills = senetSample('refills', [['Клуб 1', xlTime('2026-10-01 20:00:00'), 'гость1', 'General', null, 500, null]]);
    expect(parseReport('refills', refills, TZ).rows).toEqual([
      { at: '2026-10-01T15:00:00.000Z', guestLogin: 'гость1', accountType: 'General', amount: 50_000, workstation: null, phone: null },
    ]);
  });

  it('нет обязательной колонки — SenetError bad_format с именем отчёта', () => {
    const data = senetSample('cashMoves', [['Клуб 1', xlTime('2026-10-01 22:00:00'), 'Сотрудник А', 'Вынесение', 'kaspi']], SENET_HEADERS.cashMoves.filter((h) => h !== 'Сумма операции'));
    try {
      parseReport('cashMoves', data, TZ);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SenetError);
      expect((e as SenetError).code).toBe('bad_format');
      expect((e as SenetError).report).toBe('cashMoves');
    }
  });

  it('не xlsx — bad_format', () => {
    expect(() => parseReport('sessions', Buffer.from('<html>вход</html>'), TZ)).toThrow(SenetError);
  });

  it('stock, goodsMoves, load — строк нет (разбор по пробному забору)', () => {
    expect(parseReport('stock', senetSample('sessions', []), TZ).rows).toBeNull();
  });
});
