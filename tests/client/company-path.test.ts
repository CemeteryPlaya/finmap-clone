import { describe, expect, it } from 'vitest';
import { pickStartCompany, switchCompanyPath } from '../../src/client/lib/company-path';
import type { Company } from '../../src/client/lib/queries';

const c = (id: number, archived = false): Company => ({ id, name: `К${id}`, baseCurrency: 'KZT', createdAt: 'x', archivedAt: archived ? 'x' : null });

describe('company-path', () => {
  it('switchCompanyPath: тот же раздел у другой компании', () => {
    expect(switchCompanyPath('/c/5/settings/accounts', 7)).toBe('/c/7/settings/accounts');
    expect(switchCompanyPath('/c/5/log', 12)).toBe('/c/12/log');
    expect(switchCompanyPath('/c/5', 7)).toBe('/c/7');
    expect(switchCompanyPath('/companies/new', 7)).toBe('/c/7/log');
    expect(switchCompanyPath('/c/55x/log', 7)).toBe('/c/7/log');
  });

  it('pickStartCompany: последняя активная, иначе первая активная (Review Focus 5)', () => {
    const list = [c(1), c(2, true), c(3)];
    expect(pickStartCompany(list, 3)?.id).toBe(3);
    expect(pickStartCompany(list, 2)?.id).toBe(1); // в архиве
    expect(pickStartCompany(list, 99)?.id).toBe(1); // удалена
    expect(pickStartCompany(list, '3')?.id).toBe(1); // не число
    expect(pickStartCompany(list, undefined)?.id).toBe(1);
    expect(pickStartCompany([c(2, true)], 2)).toBeUndefined();
  });
});
