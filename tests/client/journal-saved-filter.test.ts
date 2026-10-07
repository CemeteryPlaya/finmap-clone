import { describe, expect, it } from 'vitest';
import { EMPTY_JOURNAL_STATE, savedFilterFromState, stateFromSavedFilter, type JournalUrlState } from '../../src/client/lib/journal-filter';

const state = (patch: Partial<JournalUrlState>): JournalUrlState => ({ ...EMPTY_JOURNAL_STATE, ...patch });

describe('сохранённый фильтр ↔ фильтр журнала', () => {
  it('сохраняется только заданное; относительный период — датами (решение 6 плана 5a); сортировка не сохраняется', () => {
    expect(savedFilterFromState(EMPTY_JOURNAL_STATE, '2026-10-07')).toEqual({});
    expect(
      savedFilterFromState(
        state({ period: 'month', q: 'бар', amountMin: 0, types: ['income'], tagIds: [3, 4], withoutProject: true, sort: 'amount', order: 'asc' }),
        '2026-10-07',
      ),
    ).toEqual({ from: '2026-10-01', to: '2026-10-31', q: 'бар', amountMin: 0, types: ['income'], tagIds: [3, 4], withoutProject: true });
    expect(savedFilterFromState(state({ period: 'custom', from: '2026-01-05' }), '2026-10-07')).toEqual({ from: '2026-01-05' });
  });

  it('применение: даты — «Произвольно», без дат — «Всё время», остальное заменяется, сортировка текущая', () => {
    expect(stateFromSavedFilter({ from: '2026-10-01', to: '2026-10-31', accountIds: [5, 2], withoutCategory: true }, { sort: 'amount', order: 'asc' })).toEqual(
      state({ period: 'custom', from: '2026-10-01', to: '2026-10-31', accountIds: [2, 5], withoutCategory: true, sort: 'amount', order: 'asc' }),
    );
    expect(stateFromSavedFilter({ q: 'аренда', types: ['transfer', 'income'] }, { sort: 'date', order: 'desc' })).toEqual(
      state({ q: 'аренда', types: ['income', 'transfer'] }),
    );
  });

  it('туда и обратно без потерь (кроме относительного периода)', () => {
    const s = state({ period: 'custom', from: '2026-02-01', amountMax: 99, counterpartyIds: [7], withoutCounterparty: true, projectIds: [1] });
    expect(stateFromSavedFilter(savedFilterFromState(s, '2026-10-07'), s)).toEqual(s);
  });
});
