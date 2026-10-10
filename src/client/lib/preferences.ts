/** «Больше не спрашивать» в вопросе о несохранённом (§2.4, §10.2 этапа 1.5): настройка пользователя. */
export const SKIP_CLOSE_CONFIRM_PREF = 'operationForm.skipCloseConfirm';

/** Не спрашивать при закрытии изменённой формы операции. Значение неизвестного вида — по умолчанию (спрашивать). */
export function skipCloseConfirm(prefs: Record<string, unknown> | undefined): boolean {
  return prefs?.[SKIP_CLOSE_CONFIRM_PREF] === true;
}
