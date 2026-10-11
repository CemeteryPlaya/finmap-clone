import { describe, expect, it } from 'vitest';
import { applyEdit, journalViewChanges, journalViewPref, savedJournalView, shownJournalView, type JournalView } from '../../src/client/lib/journal-view';

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

  it('сервер уже равен правке — это не изменение, «Применить» недоступна (Review Focus 3, итоги 1.5-2a №5)', () => {
    const serverNow: JournalView = { ...saved, ask: false };
    expect(journalViewChanges(serverNow, { ask: false })).toEqual([]);
  });

  it('настройка без правки следует за сервером; с правкой — показывает правку', () => {
    const serverNow: JournalView = { ...saved, wrap: true };
    expect(shownJournalView(serverNow, { ask: false })).toEqual({ columns: saved.columns, wrap: true, ask: false });
    expect(journalViewChanges(serverNow, { ask: false })).toEqual(['ask']);
  });

  it('applyEdit: правка и возврат к сохранённому — правок нет', () => {
    const once = applyEdit(saved, {}, { wrap: true });
    expect(once).toEqual({ wrap: true });
    expect(applyEdit(saved, once, { wrap: false })).toEqual({});
    expect(applyEdit(saved, applyEdit(saved, {}, { columns: ['date', 'amount'] }), { columns: ['date', 'amount', 'account'] })).toEqual({});
  });

  it('applyEdit: изменённое поле остаётся правкой, соседнее возвращается и уходит', () => {
    const edits = applyEdit(saved, { wrap: true }, { ask: false });
    expect(edits).toEqual({ wrap: true, ask: false });
    expect(applyEdit(saved, edits, { ask: true })).toEqual({ wrap: true });
  });

  it('applyEdit: поле без правки следует за новым сохранённым', () => {
    const edits = applyEdit(saved, applyEdit(saved, {}, { wrap: true }), { wrap: false });
    const serverNow: JournalView = { ...saved, wrap: true };
    expect(shownJournalView(serverNow, edits).wrap).toBe(true);
  });

  it('значения для PUT /preferences: вопрос — обратный к operationForm.skipCloseConfirm', () => {
    const view: JournalView = { columns: ['date'], wrap: true, ask: false };
    expect(journalViewPref(view, 'columns')).toEqual({ pref: 'journal.columns', value: ['date'] });
    expect(journalViewPref(view, 'wrap')).toEqual({ pref: 'journal.wrap', value: true });
    expect(journalViewPref(view, 'ask')).toEqual({ pref: 'operationForm.skipCloseConfirm', value: true });
  });
});
