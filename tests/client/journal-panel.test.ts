import { describe, expect, it } from 'vitest';
import { EMPTY_JOURNAL_STATE, panelConditionCount, SORT_CHOICES, type JournalUrlState } from '../../src/client/lib/journal-filter';

const state = (patch: Partial<JournalUrlState>): JournalUrlState => ({ ...EMPTY_JOURNAL_STATE, ...patch });

describe('кнопка «Фильтры» на телефоне', () => {
  it('считает спрятанное в панели: период, сумму от и до, условия окна «Фильтр»; поиск и сортировка не в счёт', () => {
    expect(panelConditionCount(EMPTY_JOURNAL_STATE)).toBe(0);
    expect(panelConditionCount(state({ q: 'аренда', sort: 'amount', order: 'asc' }))).toBe(0);
    expect(panelConditionCount(state({ period: 'month' }))).toBe(1);
    expect(panelConditionCount(state({ period: 'custom', from: '2026-10-01' }))).toBe(1);
    expect(panelConditionCount(state({ amountMin: 100, amountMax: 500 }))).toBe(2);
    // условия окна — по разделу, как у кнопки «Фильтр»: два счёта — одно условие, «без статьи» и статья — одно
    expect(panelConditionCount(state({ types: ['expense'], accountIds: [1, 2], categoryIds: [3], withoutCategory: true }))).toBe(3);
    expect(panelConditionCount(state({ period: 'today', amountMin: 0, tagIds: [7] }))).toBe(3);
  });

  it('сортировка списком: четыре варианта, без повторов', () => {
    expect(SORT_CHOICES.map((s) => `${s.sort}:${s.order}`)).toEqual(['date:desc', 'date:asc', 'amount:desc', 'amount:asc']);
  });
});
