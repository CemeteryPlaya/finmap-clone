import { describe, expect, it } from 'vitest';
import { acceptHeading, GIVE_UP_MS, NO_NAVIGATION_MS, SAME_PAGE_MS } from '../../src/client/lib/focus-heading';

describe('фокус на заголовок новой страницы после перехода из панели (§11 этапа 1.5)', () => {
  it('новый <h1> берётся сразу; прежний — пока адрес не сменился, не берётся', () => {
    expect(acceptHeading({ isPrevious: false, elapsed: 16, changedAt: null })).toBe(true);
    expect(acceptHeading({ isPrevious: false, elapsed: 16, changedAt: 16 })).toBe(true);
    // адрес сменился, а на месте ещё старый заголовок: React Router рисует новую страницу в startTransition
    expect(acceptHeading({ isPrevious: true, elapsed: 50, changedAt: 32 })).toBe(false);
    expect(acceptHeading({ isPrevious: true, elapsed: 32 + SAME_PAGE_MS - 1, changedAt: 32 })).toBe(false);
  });

  it('прежний заголовок пережил смену адреса — та же страница (другая компания); адрес не сменился — переход на текущую страницу', () => {
    expect(acceptHeading({ isPrevious: true, elapsed: 32 + SAME_PAGE_MS, changedAt: 32 })).toBe(true);
    expect(acceptHeading({ isPrevious: true, elapsed: NO_NAVIGATION_MS - 1, changedAt: null })).toBe(false);
    expect(acceptHeading({ isPrevious: true, elapsed: NO_NAVIGATION_MS, changedAt: null })).toBe(true);
    expect(GIVE_UP_MS).toBeGreaterThan(NO_NAVIGATION_MS + SAME_PAGE_MS);
  });
});
