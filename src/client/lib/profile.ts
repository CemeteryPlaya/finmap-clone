/** Черновик страницы «Профиль» (§7.4 этапа 1.5): имя и три поля пароля. */
export interface ProfileDraft {
  name: string;
  current: string;
  next: string;
  again: string;
}

export type ProfileField = 'name' | 'current' | 'next' | 'again';
export type ProfileFields = Partial<Record<ProfileField, string>>;

/** Что отправить по «Сохранить»: имя (если изменилось) и пароль (если начат) — или ошибки полей без запроса. */
export type ProfilePlan =
  | { ok: false; fields: ProfileFields }
  | { ok: true; name: string | null; password: { currentPassword: string; newPassword: string } | null };

const passwordStarted = (d: ProfileDraft) => d.current !== '' || d.next !== '' || d.again !== '';

/** Есть что сохранять: другое имя или начат пароль. */
export function profileDirty(draft: ProfileDraft, savedName: string): boolean {
  return draft.name.trim() !== savedName || passwordStarted(draft);
}

export function profilePlan(draft: ProfileDraft, savedName: string): ProfilePlan {
  const name = draft.name.trim();
  const fields: ProfileFields = {};
  if (!name) fields.name = 'Введите имя';
  const password = passwordStarted(draft);
  if (password) {
    if (!draft.current) fields.current = 'Введите текущий пароль';
    if (!draft.next) fields.next = 'Введите новый пароль';
    else if (draft.next !== draft.again) fields.again = 'Пароли не совпадают';
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    name: name !== savedName ? name : null,
    password: password ? { currentPassword: draft.current, newPassword: draft.next } : null,
  };
}

/** Ошибки сервера (`name`, `currentPassword`, `newPassword`) — у полей страницы. */
export function profileServerFields(fields: Record<string, string>): ProfileFields {
  return {
    ...(fields.currentPassword ? { current: fields.currentPassword } : {}),
    ...(fields.newPassword ? { next: fields.newPassword } : {}),
    ...(fields.name ? { name: fields.name } : {}),
  };
}

/**
 * Куда показать отказ сервера: поля, которые есть на странице, — у полей; иначе (нет полей или ключ, которого на
 * странице нет, например `password`) — общий текст ошибки, чтобы отказ не пропал молча.
 */
export function profileServerError(fields: Record<string, string> | undefined, message: string): { fields: ProfileFields; error: string | null } {
  const mapped = fields ? profileServerFields(fields) : {};
  return Object.keys(mapped).length > 0 ? { fields: mapped, error: null } : { fields: {}, error: message };
}

/** Правка полей убирает их прежние ошибки: «Пароли не совпадают» не висит, пока поле исправляют. */
export function clearEditedFields(fields: ProfileFields, edited: Partial<ProfileDraft>): ProfileFields {
  const next = { ...fields };
  for (const key of Object.keys(edited) as ProfileField[]) delete next[key];
  return next;
}
