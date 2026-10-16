import { describe, expect, it } from 'vitest';
import { dealDay } from '../../src/client/lib/journal-format';
import { JOURNAL_WRAP_PREF, journalWrap, PNL_BANNER_PREF, pnlBannerHidden, prefsSaveError, SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../src/client/lib/preferences';

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

describe('ошибка «Применить» в «Настройках журнала» (§7.5 этапа 1.5, итоги 1.5-1b №5)', () => {
  it('сначала что не сохранилось и почему, затем что уже сохранено; имена — как подписи на странице', () => {
    expect(prefsSaveError([], 'Колонки', 'Сбой')).toBe('Не удалось сохранить «Колонки»: Сбой.');
    expect(prefsSaveError([], 'Колонки', 'Что-то пошло не так?!…')).toBe('Не удалось сохранить «Колонки»: Что-то пошло не так.');
    expect(prefsSaveError([], 'Колонки', ' . ')).toBe('Не удалось сохранить «Колонки»: Ошибка сервера.');
    expect(prefsSaveError([], 'Колонки', '')).toBe('Не удалось сохранить «Колонки»: Ошибка сервера.');
    expect(prefsSaveError(['Колонки'], 'Спрашивать перед закрытием формы', 'Сбой сохранения.')).toBe(
      'Не удалось сохранить «Спрашивать перед закрытием формы»: Сбой сохранения. Сохранено: «Колонки».',
    );
    expect(prefsSaveError(['Колонки', 'Показывать полностью'], 'Спрашивать перед закрытием формы', 'Нет связи с сервером')).toBe(
      'Не удалось сохранить «Спрашивать перед закрытием формы»: Нет связи с сервером. Сохранено: «Колонки», «Показывать полностью».',
    );
  });

  it('сбой посередине: непопробованная настройка не названа сохранённой (M4 итогов 1.5-4b)', () => {
    const text = prefsSaveError(['Колонки'], 'Показывать полностью', 'Сбой');
    expect(text).toBe('Не удалось сохранить «Показывать полностью»: Сбой. Сохранено: «Колонки».');
    expect(text).not.toMatch(/Остальное/);
  });
});

describe('баннер «Прибыли» (§5.1)', () => {
  it('скрыт только при true; дата сделки — своя или день платежа в поясе приложения', () => {
    expect(pnlBannerHidden({ [PNL_BANNER_PREF]: true })).toBe(true);
    for (const v of [false, 'true', null, undefined]) expect(pnlBannerHidden({ [PNL_BANNER_PREF]: v })).toBe(false);
    expect(pnlBannerHidden(undefined)).toBe(false);
    expect(PNL_BANNER_PREF).toBe('analytics.pnlBannerHidden');
    expect(dealDay({ accrualDate: '2026-08-15', paidAt: '2026-09-10T06:00:00.000Z' }, 'Asia/Almaty')).toBe('2026-08-15');
    // 31 августа 20:30 UTC — уже 1 сентября по Алматы
    expect(dealDay({ accrualDate: null, paidAt: '2026-08-31T20:30:00.000Z' }, 'Asia/Almaty')).toBe('2026-09-01');
  });
});
