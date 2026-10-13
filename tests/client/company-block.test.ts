import { describe, expect, it } from 'vitest';
import { companyInitials, filterCompanies, SEARCH_FROM } from '../../src/client/lib/company-block';

describe('блок компании и панель «Компании» (§3.1–3.2 этапа 1.5)', () => {
  it('инициалы — первые буквы двух первых слов без формы собственности и кавычек', () => {
    expect(companyInitials('ТОО «Демо Клубы»')).toBe('ДК');
    expect(companyInitials('ИП Лютик 123')).toBe('Л1');
    expect(companyInitials('Nova Game Club')).toBe('NG');
    expect(companyInitials('Demo Ltd')).toBe('D');
    expect(companyInitials('ТОО')).toBe('Т');
    expect(companyInitials('  ')).toBe('?');
    expect(companyInitials('ёлка')).toBe('Ё');
  });

  it('поиск без учёта регистра и «ё»; пустой запрос — все; порог появления поля', () => {
    const list = [{ name: 'ТОО Ёлка' }, { name: 'ИП Берёза' }, { name: 'Клуб Север' }];
    expect(filterCompanies(list, 'елк').map((c) => c.name)).toEqual(['ТОО Ёлка']);
    expect(filterCompanies(list, 'БЕРЕЗ').map((c) => c.name)).toEqual(['ИП Берёза']);
    expect(filterCompanies(list, '  ')).toEqual(list);
    expect(filterCompanies(list, 'нет такой')).toEqual([]);
    expect(SEARCH_FROM).toBe(5);
  });
});
