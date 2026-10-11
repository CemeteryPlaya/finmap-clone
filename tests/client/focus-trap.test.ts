import { describe, expect, it } from 'vitest';
import { fieldAutoFocusAllowed, tabTarget, tabbable, type TabCandidate } from '../../src/client/components/focus-trap';

describe('fieldAutoFocusAllowed: фокус в поле при открытии формы', () => {
  it('на компьютере ставится, на устройстве с пальцем (pointer: coarse) нет — иначе поднимется клавиатура', () => {
    expect(fieldAutoFocusAllowed(false)).toBe(true);
    expect(fieldAutoFocusAllowed(true)).toBe(false);
  });
});

const el = (id: string, over: Partial<TabCandidate> = {}): TabCandidate & { id: string } => ({ id, disabled: false, hidden: false, ...over });
const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe('tabbable: куда попадает Tab в модальном окне', () => {
  it('оставляет доступные элементы в порядке обхода', () => {
    expect(ids(tabbable([el('a'), el('b'), el('c')]))).toEqual(['a', 'b', 'c']);
  });

  it('пропускает недоступные (в том числе внутри fieldset[disabled]) и скрытые или inert', () => {
    const list = [el('a', { disabled: true }), el('b'), el('c', { hidden: true }), el('d')];
    expect(ids(tabbable(list))).toEqual(['b', 'd']);
  });

  it('из группы радиокнопок берёт только отмеченную', () => {
    const list = [el('r1', { radioGroup: 'f:type' }), el('r2', { radioGroup: 'f:type', checked: true }), el('r3', { radioGroup: 'f:type' }), el('x')];
    expect(ids(tabbable(list))).toEqual(['r2', 'x']);
  });

  it('если в группе ничего не отмечено, берёт первую', () => {
    const list = [el('x'), el('r1', { radioGroup: 'f:type' }), el('r2', { radioGroup: 'f:type' })];
    expect(ids(tabbable(list))).toEqual(['x', 'r1']);
  });

  it('группы с разными именами независимы; недоступная или скрытая радиокнопка группу не представляет', () => {
    const list = [
      el('a1', { radioGroup: 'f:a', disabled: true }),
      el('a2', { radioGroup: 'f:a' }),
      el('b1', { radioGroup: 'f:b', hidden: true, checked: true }),
      el('b2', { radioGroup: 'f:b' }),
    ];
    expect(ids(tabbable(list))).toEqual(['a2', 'b2']);
  });

  it('пропускает элементы с tabindex меньше нуля (например, кнопка с tabindex="-1")', () => {
    const list = [el('a'), el('b', { tabIndex: -1 }), el('c', { tabIndex: 0 }), el('d')];
    expect(ids(tabbable(list))).toEqual(['a', 'c', 'd']);
  });

  it('пропускает элементы вложенного окна (подтверждение поверх формы, окно поверх панели)', () => {
    const list = [el('a'), el('b', { nested: true }), el('c'), el('d', { nested: true })];
    expect(ids(tabbable(list))).toEqual(['a', 'c']);
  });
});

describe('tabTarget: куда Tab по кругу переведёт фокус (null — оставить браузеру)', () => {
  const root = 'root';
  const items = ['a', 'b', 'c'];

  it('с последнего элемента Tab — на первый, с первого Shift+Tab — на последний', () => {
    expect(tabTarget(items, 'c', root, false)).toBe('a');
    expect(tabTarget(items, 'a', root, true)).toBe('c');
  });

  it('в середине списка браузер ходит сам', () => {
    expect(tabTarget(items, 'b', root, false)).toBeNull();
    expect(tabTarget(items, 'b', root, true)).toBeNull();
    expect(tabTarget(items, 'a', root, false)).toBeNull();
    expect(tabTarget(items, 'c', root, true)).toBeNull();
  });

  it('фокус на самом окне (форма ещё грузится): Tab — на первый, Shift+Tab — на последний', () => {
    expect(tabTarget(items, root, root, false)).toBe('a');
    expect(tabTarget(items, root, root, true)).toBe('c');
  });

  it('нет доступных элементов — ничего не делать', () => {
    expect(tabTarget([], root, root, false)).toBeNull();
  });
});
