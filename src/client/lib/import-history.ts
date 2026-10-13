import { formatDateTime, formatDateTimeSec } from '../../shared/dates';
import type { ImportListItem } from '../../shared/schemas/imports';
import { formatCount, operationsText } from './import-panel';

/**
 * Вкладка «Импорты» панели «История действий» (§7 спецификации импорта): вкладки, тексты записей, подтверждения и итога
 * отмены (тесты — в node без DOM) и запрос отмены.
 */

export type HistoryTab = 'log' | 'imports';

/** Вкладки-пилюли панели (§7.1): «Стартового баланса», как у Finmap, нет — такого действия у нас нет. */
export const HISTORY_TABS: readonly { key: HistoryTab; label: string }[] = [
  { key: 'log', label: 'Журнал' },
  { key: 'imports', label: 'Импорты' },
];

/** Вкладка после клавиши (roving tabindex, §7.1): ←/→ по кругу, Home и End — крайние; другая клавиша — null. */
export function tabAfterKey(current: HistoryTab, key: string): HistoryTab | null {
  const i = HISTORY_TABS.findIndex((t) => t.key === current);
  const n = HISTORY_TABS.length;
  switch (key) {
    case 'ArrowRight':
      return HISTORY_TABS[(i + 1) % n]!.key;
    case 'ArrowLeft':
      return HISTORY_TABS[(i - 1 + n) % n]!.key;
    case 'Home':
      return HISTORY_TABS[0]!.key;
    case 'End':
      return HISTORY_TABS[n - 1]!.key;
    default:
      return null;
  }
}

/** Вторая строка записи (§7.2): «Добавлено 16 028 операций · пропущено дубликатов 0». */
export function importAddedText(item: ImportListItem): string {
  return `Добавлено ${operationsText(item.counts.added)} · пропущено дубликатов ${formatCount(item.counts.duplicates)}`;
}

/** У отменённого (§7.2): «Отменён 12.10.2026, 15:40 (Санжар)». */
export function importUndoneText(item: ImportListItem, timeZone: string): string | null {
  if (item.status !== 'undone' || item.undoneAt === null) return null;
  return `Отменён ${formatDateTime(item.undoneAt, timeZone)}${item.undoneByName ? ` (${item.undoneByName})` : ''}`;
}

/** Третья строка (§7.2): «Санжар · 12.10.2026, 15:02:11». */
export function importMetaText(item: ImportListItem, timeZone: string): string {
  return `${item.userName ?? 'Пользователь удалён'} · ${formatDateTimeSec(item.createdAt, timeZone)}`;
}
