import type { InfiniteData } from '@tanstack/react-query';
import { formatDateTime, formatDateTimeSec } from '../../shared/dates';
import type {
  ImportCreatedEntity,
  ImportKeptAccountField,
  ImportListItem,
  ImportListPage,
  ImportUndoRequest,
  ImportUndoResponse,
  ImportUndoResult,
} from '../../shared/schemas/imports';
import { api } from './api';
import { createdParts, formatCount, operationsText } from './import-panel';
import { pluralRu } from './journal-format';

/**
 * Вкладка «Импорты» панели «История действий» (§7 спецификации импорта): вкладки, тексты записи, подтверждения и итога
 * отмены (тесты — в node без DOM), запись после отмены в загруженном списке и запрос отмены.
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

/** Вторая строка записи (§7.2): «Добавлено 1 234 операции · пропущено дубликатов 0». */
export function importAddedText(item: ImportListItem): string {
  return `Добавлено ${operationsText(item.counts.added)} · пропущено дубликатов ${formatCount(item.counts.duplicates)}`;
}

/** У отменённого (§7.2): «Отменён 12.10.2026, 15:40 (Сотрудник А)». */
export function importUndoneText(item: ImportListItem, timeZone: string): string | null {
  if (item.status !== 'undone' || item.undoneAt === null) return null;
  return `Отменён ${formatDateTime(item.undoneAt, timeZone)}${item.undoneByName ? ` (${item.undoneByName})` : ''}`;
}

/** Третья строка (§7.2): «Сотрудник А · 12.10.2026, 15:02:11». */
export function importMetaText(item: ImportListItem, timeZone: string): string {
  return `${item.userName ?? 'Пользователь удалён'} · ${formatDateTimeSec(item.createdAt, timeZone)}`;
}

/** Доступное имя кнопки «Отменить» (§7.2): «Отменить импорт «выгрузка.xlsx» от 12.10.2026, 15:02». */
export function undoButtonLabel(item: ImportListItem, timeZone: string): string {
  return `Отменить импорт «${item.fileName}» от ${formatDateTime(item.createdAt, timeZone)}`;
}

/** Флажок подтверждения (§7.3): «Удалить и изменённые (3)». */
export function undoCheckboxLabel(edited: number): string {
  return `Удалить и изменённые (${formatCount(edited)})`;
}

/**
 * Текст подтверждения отмены (§7.3): сколько операций удалится, с флажком — и изменённые; если изменённые есть — что
 * с ними будет. Все операции изменены и флажок снят — операций не удаляется.
 */
export function undoConfirmText(item: ImportListItem, includeEdited: boolean): string {
  const p = item.pending ?? { operations: 0, edited: 0 };
  const n = includeEdited ? p.operations : p.operations - p.edited;
  const rest = 'созданные импортом счета, категории, контрагенты, проекты и теги, если они больше нигде не используются.';
  const head =
    n > 0
      ? `${pluralRu(n, 'Будет удалена', 'Будут удалены', 'Будут удалены')} ${operationsText(n)} из файла «${item.fileName}», а также ${rest}`
      : `Операции из файла «${item.fileName}» не удаляются. Будут удалены ${rest}`;
  if (p.edited === 0) return head;
  const edited = `После импорта ${pluralRu(p.edited, 'изменена', 'изменены', 'изменены')} ${operationsText(p.edited)}`;
  const fate = includeEdited
    ? pluralRu(p.edited, 'она тоже будет удалена', 'они тоже будут удалены', 'они тоже будут удалены')
    : pluralRu(p.edited, 'она останется', 'они останутся', 'они останутся');
  return `${head} ${edited} — ${fate}.`;
}

const ENTITY_SINGULAR: Record<ImportCreatedEntity, string> = {
  account: 'счёт',
  category: 'категория',
  counterparty: 'контрагент',
  project: 'проект',
  tag: 'тег',
};

/** Поле счёта, оставленное как есть: «стартовый баланс счёта «Касса» (изменён после импорта)». */
function keptAccountText(k: ImportKeptAccountField): string {
  const what = k.field === 'startingBalance' ? 'стартовый баланс' : 'дата открытия';
  const why =
    k.reason === 'archived'
      ? 'счёт в архиве'
      : k.reason === 'operations'
        ? 'есть операции раньше прежней даты'
        : k.field === 'startingBalance'
          ? 'изменён после импорта'
          : 'изменена после импорта';
  return `${what} счёта «${k.name}» (${why})`;
}

/**
 * Итог отмены (§7.3) — в живую область панели: «Импорт отменён: удалено 1 230 операций, 2 счёта, 12 категорий,
 * 25 контрагентов, 1 тег. Оставлено: 4 изменённые операции, категория «Аренда» (используется).»
 */
export function undoResultText(r: ImportUndoResult): string {
  const deleted = [operationsText(r.deleted.operations), ...createdParts(r.deleted)];
  const keptTotal = r.kept.created.accounts + r.kept.created.categories + r.kept.created.counterparties + r.kept.created.projects + r.kept.created.tags;
  const more = keptTotal - r.kept.names.length;
  const kept = [
    ...(r.kept.operations > 0
      ? [`${formatCount(r.kept.operations)} ${pluralRu(r.kept.operations, 'изменённая операция', 'изменённые операции', 'изменённых операций')}`]
      : []),
    ...r.kept.names.map((x) => `${ENTITY_SINGULAR[x.entity]} «${x.name}» (используется)`),
    ...(more > 0 ? [`и ещё ${formatCount(more)} (используются)`] : []),
    ...r.kept.accounts.map(keptAccountText),
  ];
  return `Импорт отменён: удалено ${deleted.join(', ')}.${kept.length > 0 ? ` Оставлено: ${kept.join(', ')}.` : ''}`;
}

/** Запись импорта после отмены — вместо прежней в загруженных страницах списка (до перечитывания). */
export function replaceImportItem(
  data: InfiniteData<ImportListPage, number | null> | undefined,
  item: ImportListItem,
): InfiniteData<ImportListPage, number | null> | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === item.id ? item : x)) })) };
}

/** Отмена импорта (§6.2): POST …/imports/:id/undo. */
export function undoImport(companyId: number, importId: number, body: ImportUndoRequest): Promise<ImportUndoResponse> {
  return api<ImportUndoResponse>(`/companies/${companyId}/imports/${importId}/undo`, { method: 'POST', body });
}
