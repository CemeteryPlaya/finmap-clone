/** Колонки журнала (§7) в порядке показа. Дата и сумма видны всегда — по ним сортируют. */
export const JOURNAL_COLUMNS = [
  { id: 'date', label: 'Дата', fixed: true },
  { id: 'amount', label: 'Сумма', fixed: true },
  { id: 'account', label: 'Счёт', fixed: false },
  { id: 'counterparty', label: 'Контрагент', fixed: false },
  { id: 'category', label: 'Категория', fixed: false },
  { id: 'project', label: 'Проект', fixed: false },
  { id: 'comment', label: 'Комментарий', fixed: false },
] as const;

export type JournalColumnId = (typeof JOURNAL_COLUMNS)[number]['id'];

/** Ключ настройки пользователя (`user_preferences`): массив id видимых колонок. */
export const JOURNAL_COLUMNS_PREF = 'journal.columns';

const ALL_IDS: readonly JournalColumnId[] = JOURNAL_COLUMNS.map((c) => c.id);

/**
 * Видимые колонки из сохранённой настройки: неизвестные id отбрасываются, дата и сумма добавляются всегда,
 * порядок — как в JOURNAL_COLUMNS. Нет настройки или она не массив — все колонки.
 */
export function visibleColumns(pref: unknown): JournalColumnId[] {
  if (!Array.isArray(pref)) return [...ALL_IDS];
  const chosen = new Set(pref.filter((x): x is string => typeof x === 'string'));
  return JOURNAL_COLUMNS.filter((c) => c.fixed || chosen.has(c.id)).map((c) => c.id);
}

/** Включить или выключить колонку; дату и сумму выключить нельзя. */
export function toggleColumn(visible: readonly JournalColumnId[], id: JournalColumnId): JournalColumnId[] {
  if (JOURNAL_COLUMNS.find((c) => c.id === id)?.fixed) return [...visible];
  const next = new Set(visible);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return JOURNAL_COLUMNS.filter((c) => next.has(c.id)).map((c) => c.id);
}
