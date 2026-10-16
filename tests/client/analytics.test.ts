import { describe, expect, it } from 'vitest';
import { ANALYTICS_CARDS } from '../../src/client/lib/analytics';

describe('карточки «Аналитики» (§2.1)', () => {
  it('порядок, ссылки и неактивные карточки плановых операций', () => {
    expect(ANALYTICS_CARDS.map((c) => c.title)).toEqual(['Деньги / Cash flow', 'История действий', 'План/Факт', 'Дебиторка', 'Кредиторка', 'Баланс']);
    expect(ANALYTICS_CARDS.map((c) => c.href?.(7) ?? null)).toEqual(['/c/7/analytics/cashflow', '/c/7/settings/audit', null, null, null, null]);
    expect(ANALYTICS_CARDS.filter((c) => c.href === null).every((c) => c.inactive === 'Появится с плановыми операциями')).toBe(true);
    expect(ANALYTICS_CARDS.every((c) => c.help.length > 0 && c.description.length > 0)).toBe(true);
  });
});
