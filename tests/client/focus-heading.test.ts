import { describe, expect, it } from 'vitest';
import { acceptHeading, GIVE_UP_MS, isPlainLeftClick, NO_NAVIGATION_MS, pathOf, SAME_PAGE_MS, shouldAbandon } from '../../src/client/lib/focus-heading';

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

describe('когда прекращать поиск заголовка', () => {
  it('адрес прежний или равен цели — ищем дальше; другой — прекращаем', () => {
    expect(shouldAbandon({ startPath: '/c/1/log', nowPath: '/c/1/log', target: '/c/1/settings/audit' })).toBe(false);
    expect(shouldAbandon({ startPath: '/c/1/log', nowPath: '/c/1/settings/audit', target: '/c/1/settings/audit' })).toBe(false);
    expect(shouldAbandon({ startPath: '/c/1/log', nowPath: '/login', target: '/c/1/settings/audit' })).toBe(true);
  });

  it('без цели уходом считается только /login', () => {
    expect(shouldAbandon({ startPath: '/c/1/log', nowPath: '/c/2/log' })).toBe(false);
    expect(shouldAbandon({ startPath: '/c/1/log', nowPath: '/login' })).toBe(true);
    expect(pathOf('/c/1/log?account=3#x')).toBe('/c/1/log');
  });
});

describe('обычное нажатие на ссылку', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  it('левая кнопка без модификаторов — обычное', () => {
    expect(isPlainLeftClick(click)).toBe(true);
  });
  it('средняя кнопка, модификаторы и отменённое событие — нет', () => {
    expect(isPlainLeftClick({ ...click, button: 1 })).toBe(false);
    for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey', 'defaultPrevented'] as const) expect(isPlainLeftClick({ ...click, [k]: true })).toBe(false);
  });
});
