import { describe, expect, it } from 'vitest';
import { SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../src/client/lib/preferences';

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
