/** «Больше не спрашивать» в вопросе о несохранённом (§2.4, §10.2 этапа 1.5): настройка пользователя. */
export const SKIP_CLOSE_CONFIRM_PREF = 'operationForm.skipCloseConfirm';

/** Не спрашивать при закрытии изменённой формы операции. Значение неизвестного вида — по умолчанию (спрашивать). */
export function skipCloseConfirm(prefs: Record<string, unknown> | undefined): boolean {
  return prefs?.[SKIP_CLOSE_CONFIRM_PREF] === true;
}

/** «Показывать полностью» (§5.2, §10.2 этапа 1.5): длинный текст в ячейках журнала — до двух строк. */
export const JOURNAL_WRAP_PREF = 'journal.wrap';

/** Показывать полностью. Значение неизвестного вида — по умолчанию (в одну строку). */
export function journalWrap(prefs: Record<string, unknown> | undefined): boolean {
  return prefs?.[JOURNAL_WRAP_PREF] === true;
}
