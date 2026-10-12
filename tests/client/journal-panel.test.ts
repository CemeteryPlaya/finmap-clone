import { describe, expect, it } from 'vitest';
import {
  applyFilterDraft,
  clearFilterDraft,
  EMPTY_JOURNAL_STATE,
  filterDraftFrom,
  journalExportHref,
  phoneFilterCount,
  phoneMoreSet,
  pickPhoneFilterFields,
  SORT_CHOICES,
  type JournalUrlState,
} from '../../src/client/lib/journal-filter';

const state = (patch: Partial<JournalUrlState>): JournalUrlState => ({ ...EMPTY_JOURNAL_STATE, ...patch });

describe('воронка на телефоне (§8.5 этапа 1.5)', () => {
  it('считает всё, что задаёт окно «Фильтры» на телефоне: период, сумму от и до, условия окна; поиск и сортировка не в счёт', () => {
    expect(phoneFilterCount(EMPTY_JOURNAL_STATE)).toBe(0);
    expect(phoneFilterCount(state({ q: 'аренда', sort: 'amount', order: 'asc' }))).toBe(0);
    expect(phoneFilterCount(state({ period: 'month' }))).toBe(1);
    expect(phoneFilterCount(state({ period: 'custom', from: '2026-10-01' }))).toBe(1);
    expect(phoneFilterCount(state({ amountMin: 100, amountMax: 500 }))).toBe(2);
    // условия окна — по разделу, как у кнопки «Фильтр»: два счёта — одно условие, «без категории» и категория — одно
    expect(phoneFilterCount(state({ types: ['expense'], accountIds: [1, 2], categoryIds: [3], withoutCategory: true }))).toBe(3);
    expect(phoneFilterCount(state({ period: 'today', amountMin: 0, tagIds: [7] }))).toBe(3);
  });

  it('сортировка списком: четыре варианта, без повторов', () => {
    expect(SORT_CHOICES.map((s) => `${s.sort}:${s.order}`)).toEqual(['date:desc', 'date:asc', 'amount:desc', 'amount:asc']);
  });
});

describe('черновик окна «Фильтры» (§5.6, §8.5 этапа 1.5)', () => {
  const current = state({ period: 'month', q: 'аренда', amountMin: 100, types: ['expense'], sort: 'amount', order: 'asc' });

  it('на компьютере — только условия окна: период, поиск, сумма и сортировка остаются текущими', () => {
    const draft = filterDraftFrom(current, false);
    expect(draft.phone).toBeNull();
    const next = applyFilterDraft(state({ ...current, q: 'новый' }), { ...draft, fields: { ...draft.fields, types: ['income'] } });
    expect(next).toStrictEqual(state({ period: 'month', q: 'новый', amountMin: 100, types: ['income'], sort: 'amount', order: 'asc' }));
  });

  it('на телефоне — ещё период, сумма и сортировка; поиск берётся текущий (дошёл до адреса, пока окно было открыто)', () => {
    const draft = filterDraftFrom(current, true);
    expect(draft.phone).toStrictEqual({ period: 'month', amountMin: 100, sort: 'amount', order: 'asc' });
    const next = applyFilterDraft(state({ ...current, q: 'новый' }), {
      fields: draft.fields,
      phone: { period: 'custom', from: '2026-10-01', amountMax: 500, sort: 'date', order: 'desc' },
    });
    // сумму «от» в черновике сняли — в фильтре её нет совсем
    expect(next).toStrictEqual(state({ period: 'custom', from: '2026-10-01', q: 'новый', amountMax: 500, types: ['expense'] }));
  });

  it('pickPhoneFilterFields не пишет пустые границы и суммы', () => {
    expect(pickPhoneFilterFields(EMPTY_JOURNAL_STATE)).toStrictEqual({ period: 'all', sort: 'date', order: 'desc' });
    expect(pickPhoneFilterFields(state({ period: 'custom', to: '2026-10-05', amountMax: 0 }))).toStrictEqual({
      period: 'custom',
      to: '2026-10-05',
      amountMax: 0,
      sort: 'date',
      order: 'desc',
    });
  });

  it('«Очистить»: на телефоне — условия, период и сумма, сортировка остаётся; на компьютере — только условия окна', () => {
    const phone = clearFilterDraft(filterDraftFrom(current, true));
    expect(phone).toStrictEqual({ fields: filterDraftFrom(EMPTY_JOURNAL_STATE, false).fields, phone: { period: 'all', sort: 'amount', order: 'asc' } });
    expect(applyFilterDraft(current, phone)).toStrictEqual(state({ q: 'аренда', sort: 'amount', order: 'asc' }));
    const desktop = clearFilterDraft(filterDraftFrom(current, false));
    expect(desktop.phone).toBeNull();
    expect(applyFilterDraft(current, desktop)).toStrictEqual(state({ period: 'month', q: 'аренда', amountMin: 100, sort: 'amount', order: 'asc' }));
  });

  it('«Ещё условия» открыт при открытии окна, если задана сумма или сортировка не «Сначала новые»', () => {
    expect(phoneMoreSet(pickPhoneFilterFields(EMPTY_JOURNAL_STATE))).toBe(false);
    expect(phoneMoreSet(pickPhoneFilterFields(state({ period: 'today' })))).toBe(false);
    expect(phoneMoreSet(pickPhoneFilterFields(state({ amountMax: 0 })))).toBe(true);
    expect(phoneMoreSet(pickPhoneFilterFields(state({ order: 'asc' })))).toBe(true);
  });

  it('выгрузка в Excel — по фильтру, параметрами API журнала', () => {
    expect(journalExportHref(5, state({ period: 'today', types: ['expense'] }), '2026-10-12')).toBe(
      '/api/v1/companies/5/operations/export.xlsx?from=2026-10-12&to=2026-10-12&types=expense&sort=date&order=desc',
    );
  });
});
