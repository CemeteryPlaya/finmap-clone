/** Последний адрес журнала компании в этой вкладке браузера — для «← Назад к журналу» (§4.1 этапа 1.5). */
export const lastJournalKey = (companyId: number): string => `fc.lastJournal.${companyId}`;

/**
 * Ссылка «← Назад к журналу»: журнал компании с сохранённой строкой запроса (фильтр, период, поиск).
 * Принимается только строка вида `?…` без `#`: адрес всегда остаётся журналом этой компании.
 */
export function journalBackHref(companyId: number, saved: string | null): string {
  const search = saved !== null && saved.length > 1 && /^\?[^#]*$/.test(saved) ? saved : '';
  return `/c/${companyId}/log${search}`;
}

/** Журнал запоминает свою строку запроса; недоступное хранилище (приватный режим) — просто без памяти. */
export function rememberJournal(companyId: number, search: string): void {
  try {
    sessionStorage.setItem(lastJournalKey(companyId), search);
  } catch {
    // без памяти «Назад к журналу» ведёт в журнал без фильтра
  }
}

export function readLastJournal(companyId: number): string | null {
  try {
    return sessionStorage.getItem(lastJournalKey(companyId));
  } catch {
    return null;
  }
}
