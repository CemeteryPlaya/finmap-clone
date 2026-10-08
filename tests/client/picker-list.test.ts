import { createElement, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PickerList } from '../../src/client/components/SearchPicker';

const options = [
  { id: 1, label: 'Касса' },
  { id: 2, label: 'Карта' },
  { id: 3, label: 'Депозит' },
];

const render = (selectedId: number | null) =>
  renderToString(createElement(StrictMode, null, createElement(PickerList, { label: 'Счета', options, onPick: () => {}, selectedId })));

/** Пункт, на который указывает aria-activedescendant. */
const activeOption = (html: string) => {
  const id = /aria-activedescendant="([^"]+)"/.exec(html)?.[1];
  expect(id).toBeTruthy();
  return new RegExp(`<li id="${id!.replace(/[:.]/g, '\\$&')}"[^>]*>([^<]*)</li>`).exec(html);
};

describe('PickerList: активный пункт при открытии', () => {
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
