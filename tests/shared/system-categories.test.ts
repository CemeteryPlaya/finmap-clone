import { describe, expect, it } from 'vitest';
import { effectiveSystemKey, SYSTEM_CATEGORIES, systemCategory } from '../../src/shared/system-categories';

describe('системные статьи', () => {
  it('содержат 3 доходные и 6 расходных статей с русскими названиями', () => {
    expect(SYSTEM_CATEGORIES.filter((c) => c.kind === 'income').map((c) => c.key)).toEqual([
      'investment',
      'loan_repaid',
      'credit_received',
    ]);
    expect(SYSTEM_CATEGORIES.filter((c) => c.kind === 'expense').map((c) => c.key)).toEqual([
      'salary',
      'tax',
      'vat',
      'dividends',
      'credit_repayment',
      'loan_issued',
    ]);
    expect(systemCategory('loan_repaid').name).toBe('Возврат займа');
    expect(systemCategory('salary').name).toBe('Зарплата');
  });

  it('связывают статьи с типами контрагентов по спецификации', () => {
    const map = Object.fromEntries(SYSTEM_CATEGORIES.map((c) => [c.key, c.counterpartyType]));
    expect(map).toEqual({
      investment: 'investor',
      loan_repaid: 'borrower',
      credit_received: 'creditor',
      salary: 'employee',
      tax: 'tax',
      vat: 'tax',
      dividends: 'owner',
      credit_repayment: 'creditor',
      loan_issued: 'borrower',
    });
  });

  it('дочерняя статья наследует эффективный systemKey родителя', () => {
    expect(effectiveSystemKey(null, 'salary')).toBe('salary');
    expect(effectiveSystemKey('tax', null)).toBe('tax');
    expect(effectiveSystemKey(null, null)).toBeNull();
  });
});
