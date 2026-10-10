import { describe, expect, it } from 'vitest';
import { JOURNAL_WRAP_PREF, journalWrap, prefsSaveError, SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../src/client/lib/preferences';

describe('настройка «Больше не спрашивать» (§2.4, §10.2 этапа 1.5)', () => {
  it('ключ настройки пользователя', () => {
    expect(SKIP_CLOSE_CONFIRM_PREF).toBe('operationForm.skipCloseConfirm');
  });

  it('только true выключает вопрос; значения другого вида — значение по умолчанию (спрашивать)', () => {
    expect(skipCloseConfirm({ [SKIP_CLOSE_CONFIRM_PREF]: true })).toBe(true);
    for (const v of [false, 'true', 1, null, {}, []]) expect(skipCloseConfirm({ [SKIP_CLOSE_CONFIRM_PREF]: v }), String(v)).toBe(false);
    expect(skipCloseConfirm({})).toBe(false);
    expect(skipCloseConfirm(undefined)).toBe(false);
  });
});

describe('«Показывать полностью» (§5.2, §10.2 этапа 1.5)', () => {
  it('ключ journal.wrap; только true включает, прочее — по умолчанию (выключено)', () => {
    expect(JOURNAL_WRAP_PREF).toBe('journal.wrap');
    expect(journalWrap({ [JOURNAL_WRAP_PREF]: true })).toBe(true);
    for (const v of [false, 'true', 1, null, {}]) expect(journalWrap({ [JOURNAL_WRAP_PREF]: v }), String(v)).toBe(false);
    expect(journalWrap(undefined)).toBe(false);
  });
});

describe('ошибка «Применить» в «Настройках журнала» (§7.5 этапа 1.5)', () => {
  it('что сохранено и что нет — без неуклюжих оборотов', () => {
    expect(prefsSaveError([], 'колонки', 'Сбой')).toBe('Не сохранено: колонки — Сбой');
    expect(prefsSaveError(['колонки'], 'вопрос о несохранённом', 'Сбой сохранения')).toBe('Сохранено: колонки. Не сохранено: вопрос о несохранённом — Сбой сохранения');
    expect(prefsSaveError(['колонки', '«Показывать полностью»'], 'вопрос о несохранённом', 'Сбой')).toBe(
      'Сохранено: колонки, «Показывать полностью». Не сохранено: вопрос о несохранённом — Сбой',
    );
  });
});
