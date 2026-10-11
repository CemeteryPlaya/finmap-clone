import { JOURNAL_COLUMNS_PREF, visibleColumns, type JournalColumnId } from './journal-columns';
import { JOURNAL_WRAP_PREF, journalWrap, SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from './preferences';

/** Что настраивает страница «Настройки журнала» (§7.5 этапа 1.5). */
export interface JournalView {
  columns: JournalColumnId[];
  wrap: boolean;
  /** «Спрашивать перед закрытием формы…» — обратное к operationForm.skipCloseConfirm. */
  ask: boolean;
}

export type JournalViewKey = keyof JournalView;

/** Порядок сохранения — порядок на странице. */
const KEYS: readonly JournalViewKey[] = ['columns', 'wrap', 'ask'];

/** Имена настроек в сообщении об ошибке — как подписи на странице. */
export const JOURNAL_VIEW_NAMES: Record<JournalViewKey, string> = {
  columns: 'Колонки',
  wrap: 'Показывать полностью',
  ask: 'Спрашивать перед закрытием формы',
};

/** Сохранённое на сервере (кэш настроек пользователя); значения неизвестного вида — по умолчанию. */
export function savedJournalView(prefs: Record<string, unknown> | undefined): JournalView {
  return { columns: visibleColumns(prefs?.[JOURNAL_COLUMNS_PREF]), wrap: journalWrap(prefs), ask: !skipCloseConfirm(prefs) };
}

const same = (key: JournalViewKey, a: JournalView, b: JournalView) => (key === 'columns' ? a.columns.join() === b.columns.join() : a[key] === b[key]);

/** Что показывает страница: правки поверх сохранённого; настройка без правки следует за сервером. */
export function shownJournalView(saved: JournalView, edits: Partial<JournalView>): JournalView {
  return { ...saved, ...edits };
}

/**
 * Что сохранит «Применить», по порядку: правки, отличные от сохранённого. Пусто — «Применить» недоступна; считается
 * от сохранённого на сервере, поэтому после сбоя и перезапроса не залипает (итоги 1.5-2a №5).
 */
export function journalViewChanges(saved: JournalView, edits: Partial<JournalView>): JournalViewKey[] {
  const shown = shownJournalView(saved, edits);
  return KEYS.filter((key) => edits[key] !== undefined && !same(key, shown, saved));
}

/** Ключ и значение PUT /preferences/:key для настройки. */
export function journalViewPref(view: JournalView, key: JournalViewKey): { pref: string; value: unknown } {
  if (key === 'columns') return { pref: JOURNAL_COLUMNS_PREF, value: view.columns };
  if (key === 'wrap') return { pref: JOURNAL_WRAP_PREF, value: view.wrap };
  return { pref: SKIP_CLOSE_CONFIRM_PREF, value: !view.ask };
}
