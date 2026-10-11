import { describe, expect, it } from 'vitest';
import { journalViewChanges, journalViewPref, savedJournalView, shownJournalView, type JournalView } from '../../src/client/lib/journal-view';

const saved: JournalView = { columns: ['date', 'amount', 'account'], wrap: false, ask: true };

describe('«Настройки журнала»: правки поверх сохранённого (§7.5 этапа 1.5)', () => {
  it('сохранённое — из настроек пользователя; без настроек — по умолчанию', () => {
    expect(savedJournalView({ 'journal.wrap': true, 'operationForm.skipCloseConfirm': true })).toMatchObject({ wrap: true, ask: false });
    expect(savedJournalView(undefined)).toMatchObject({ wrap: false, ask: true });
  });

  it('правка, равная сохранённому, — не изменение', () => {
    expect(journalViewChanges(saved, {})).toEqual([]);
    expect(journalViewChanges(saved, { wrap: false })).toEqual([]);
    expect(journalViewChanges(saved, { columns: ['date', 'amount', 'account'] })).toEqual([]);
  });

  it('изменения — по порядку: колонки, «Показывать полностью», вопрос', () => {
    expect(journalViewChanges(saved, { ask: false, wrap: true, columns: ['date', 'amount'] })).toEqual(['columns', 'wrap', 'ask']);
  });

  it('после сбоя и перезапроса: сервер уже равен правке — «Применить» недоступна (Review Focus 3, итоги 1.5-2a №5)', () => {
    const refetched: JournalView = { ...saved, ask: false };
    expect(journalViewChanges(refetched, { ask: false })).toEqual([]);
  });

  it('настройка без правки следует за сервером; с правкой — показывает правку', () => {
    const refetched: JournalView = { ...saved, wrap: true };
    expect(shownJournalView(refetched, { ask: false })).toEqual({ columns: saved.columns, wrap: true, ask: false });
    expect(journalViewChanges(refetched, { ask: false })).toEqual(['ask']);
  });

  it('значения для PUT /preferences: вопрос — обратный к operationForm.skipCloseConfirm', () => {
    const view: JournalView = { columns: ['date'], wrap: true, ask: false };
    expect(journalViewPref(view, 'columns')).toEqual({ pref: 'journal.columns', value: ['date'] });
    expect(journalViewPref(view, 'wrap')).toEqual({ pref: 'journal.wrap', value: true });
    expect(journalViewPref(view, 'ask')).toEqual({ pref: 'operationForm.skipCloseConfirm', value: true });
  });
});
