import { createElement, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PickerList } from '../../src/client/components/SearchPicker';

const options = [
  { id: 1, label: 'Касса', suffix: '₸' },
  { id: 2, label: 'Карта' },
  { id: 3, label: 'Депозит', badge: 'системная' },
];

const render = (selectedId: number | null) =>
  renderToString(createElement(StrictMode, null, createElement(PickerList, { label: 'Счета', options, onPick: () => {}, selectedId })));

/** Пункт, на который указывает aria-activedescendant: [0] — открывающий тег и название, [1] — название. */
const activeOption = (html: string) => {
  const id = /aria-activedescendant="([^"]+)"/.exec(html)?.[1];
  expect(id).toBeTruthy();
  return new RegExp(`<li id="${id!.replace(/[:.]/g, '\\$&')}"[^>]*><span[^>]*>([^<]*)</span>`).exec(html);
};

// Проверяется только первая отрисовка (на сервере эффекты не выполняются). Повторное открытие списка
// и StrictMode-эффект проверяет e2e/operation-form.spec.ts (aria-activedescendant после повторного открытия).
describe('PickerList: активный пункт при первой отрисовке', () => {
  it('при открытии активен выбранный пункт и он отмечен aria-selected', () => {
    const li = activeOption(render(3));
    expect(li?.[1]).toBe('Депозит');
    expect(li?.[0]).toContain('aria-selected="true"');
  });

  it('без выбранного значения активен первый пункт, aria-selected нигде нет', () => {
    const html = render(null);
    expect(activeOption(html)?.[1]).toBe('Касса');
    expect(html).not.toContain('aria-selected="true"');
  });
});

describe('PickerList: бейдж и символ валюты (§6.6 этапа 1.5)', () => {
  it('бейдж и символ валюты видны, но скрыты от программ чтения: имя пункта — название', () => {
    const html = render(null);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>системная<\/span>/);
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>₸<\/span>/);
  });
});
