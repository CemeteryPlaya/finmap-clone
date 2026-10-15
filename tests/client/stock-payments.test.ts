import { describe, expect, it } from 'vitest';
import type { UnpaidDoc } from '../../src/client/lib/stock';
import {
  defaultPaymentAmount,
  distributedText,
  parsePayments,
  remainingAmount,
  unpaidDocText,
  withAmount,
  withDoc,
  withoutDoc,
} from '../../src/client/lib/stock-payments';

const doc = (over: Partial<UnpaidDoc> = {}): UnpaidDoc => ({ docId: 4, number: 'П-0001', at: '2026-10-01T10:00:00.000Z', total: 100_000, paid: 40_000, own: 0, debt: 60_000, ...over });

describe('сумма оплаты по умолчанию', () => {
  it('долг документа, но не больше остатка суммы расхода; своя оплата входит в долг', () => {
    expect(defaultPaymentAmount(doc(), null)).toBe(60_000);
    expect(defaultPaymentAmount(doc(), 25_000)).toBe(25_000);
    expect(defaultPaymentAmount(doc(), 90_000)).toBe(60_000);
    expect(defaultPaymentAmount(doc({ own: 30_000, paid: 70_000, debt: 30_000 }), null)).toBe(60_000);
    expect(defaultPaymentAmount(doc({ debt: -5, own: 0 }), null)).toBe(0);
  });

  it('остаток суммы расхода без учёта выбранного документа; сумма не введена — null', () => {
    const payments = [{ docId: 4, amount: '300' }, { docId: 5, amount: '100,5' }];
    expect(remainingAmount(100_000, payments, 2)).toBe(59_950);
    expect(remainingAmount(100_000, payments, 2, 4)).toBe(89_950);
    expect(remainingAmount(10_000, payments, 2)).toBe(0);
    expect(remainingAmount(null, payments, 2)).toBeNull();
  });
});

describe('отметка документов', () => {
  it('новый документ получает сумму по умолчанию, повторная отметка ничего не меняет, снятие убирает', () => {
    const first = withDoc([], doc(), 100_000, 2);
    expect(first).toEqual([{ docId: 4, amount: '600' }]);
    expect(withDoc(first, doc(), 100_000, 2)).toEqual(first);
    // второй документ получает остаток суммы расхода
    expect(withDoc(first, doc({ docId: 5, debt: 90_000, total: 90_000, paid: 0 }), 100_000, 2)).toEqual([
      { docId: 4, amount: '600' },
      { docId: 5, amount: '400' },
    ]);
    expect(withoutDoc(first, 4)).toEqual([]);
    expect(withAmount(first, 4, '1')).toEqual([{ docId: 4, amount: '1' }]);
  });

  it('остатка не осталось — сумма пуста: пользователь введёт её сам', () => {
    expect(withDoc([{ docId: 9, amount: '1000' }], doc(), 100_000, 2)).toEqual([{ docId: 9, amount: '1000' }, { docId: 4, amount: '' }]);
  });
});

describe('parsePayments', () => {
  it('суммы в минимальных единицах и итог', () => {
    expect(parsePayments([{ docId: 4, amount: '600' }, { docId: 5, amount: '0,5' }], 2)).toEqual({
      ok: true,
      list: [{ docId: 4, amount: 60_000 }, { docId: 5, amount: 50 }],
      total: 60_050,
    });
    expect(parsePayments([], 2)).toEqual({ ok: true, list: [], total: 0 });
  });

  it('пустая, нулевая и неверная сумма — ошибка', () => {
    for (const amount of ['', '0', 'x', '-5']) {
      expect(parsePayments([{ docId: 4, amount }], 2)).toEqual({ ok: false, error: 'Укажите сумму оплаты по каждому документу' });
    }
  });
});

describe('тексты', () => {
  it('«Распределено X из Y»', () => {
    expect(distributedText([{ docId: 4, amount: '600' }], 100_000, 'KZT')).toBe('Распределено 600\u00A0₸ из 1\u202F000\u00A0₸');
    expect(distributedText([{ docId: 4, amount: '600' }], null, 'KZT')).toBe('Распределено 600\u00A0₸');
  });

  it('строка документа: номер, дата, сумма, долг или «оплачено»', () => {
    expect(unpaidDocText(doc(), '01.10.2026', 'KZT')).toBe('П-0001 от 01.10.2026 · сумма 1\u202F000\u00A0₸ · долг 600\u00A0₸');
    expect(unpaidDocText(doc({ paid: 100_000, own: 100_000, debt: 0 }), '01.10.2026', 'KZT')).toBe('П-0001 от 01.10.2026 · сумма 1\u202F000\u00A0₸ · долг 1\u202F000\u00A0₸');
    expect(unpaidDocText(doc({ paid: 100_000, debt: 0 }), '01.10.2026', 'KZT')).toBe('П-0001 от 01.10.2026 · сумма 1\u202F000\u00A0₸ · оплачено');
  });
});
