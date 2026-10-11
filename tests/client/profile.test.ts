import { describe, expect, it } from 'vitest';
import { profileDirty, profilePlan, profileServerFields } from '../../src/client/lib/profile';

const draft = (patch: Partial<{ name: string; current: string; next: string; again: string }> = {}) => ({
  name: 'Админ',
  current: '',
  next: '',
  again: '',
  ...patch,
});

describe('«Профиль»: одна «Сохранить» для имени и пароля (§7.4 этапа 1.5)', () => {
  it('только имя', () => {
    expect(profilePlan(draft({ name: ' Админ 2 ' }), 'Админ')).toEqual({ ok: true, name: 'Админ 2', password: null });
  });

  it('только пароль — имя не уходит', () => {
    expect(profilePlan(draft({ current: 'old-pass-1', next: 'new-pass-12', again: 'new-pass-12' }), 'Админ')).toEqual({
      ok: true,
      name: null,
      password: { currentPassword: 'old-pass-1', newPassword: 'new-pass-12' },
    });
  });

  it('часть пароля или повтор не совпал — ошибки у полей, запроса нет (Review Focus 4)', () => {
    expect(profilePlan(draft({ next: 'new-pass-12', again: 'new-pass-12' }), 'Админ')).toEqual({ ok: false, fields: { current: 'Введите текущий пароль' } });
    expect(profilePlan(draft({ current: 'old-pass-1' }), 'Админ')).toEqual({ ok: false, fields: { next: 'Введите новый пароль' } });
    expect(profilePlan(draft({ current: 'old-pass-1', next: 'new-pass-12', again: 'new-pass-13' }), 'Админ')).toEqual({
      ok: false,
      fields: { again: 'Пароли не совпадают' },
    });
    expect(profilePlan(draft({ name: '  ' }), 'Админ')).toEqual({ ok: false, fields: { name: 'Введите имя' } });
  });

  it('нечего сохранять — «Сохранить» недоступна', () => {
    expect(profileDirty(draft(), 'Админ')).toBe(false);
    expect(profileDirty(draft({ name: 'Админ ' }), 'Админ')).toBe(false);
    expect(profileDirty(draft({ name: 'Админ 2' }), 'Админ')).toBe(true);
    expect(profileDirty(draft({ again: 'x' }), 'Админ')).toBe(true);
  });

  it('ошибки сервера — у своих полей', () => {
    expect(profileServerFields({ currentPassword: 'Неверный текущий пароль', newPassword: 'Не короче 10 символов', name: 'Слишком длинное' })).toEqual({
      current: 'Неверный текущий пароль',
      next: 'Не короче 10 символов',
      name: 'Слишком длинное',
    });
    expect(profileServerFields({})).toEqual({});
  });
});
