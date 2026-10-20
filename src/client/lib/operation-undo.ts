import { formatDateTimeSec } from '../../shared/dates';
import type { UndoPreview, UndoPreviewEntry, UndoResult } from '../../shared/schemas/audit';
import { api } from './api';
import { pluralRu } from './journal-format';

/**
 * «Отмена» в «Истории действий» журнала (спецификация 2026-10-19, часть 2): запросы, тексты окна подтверждения и
 * заголовки действий с операциями — общие для панели истории и полной страницы.
 */

export type OperationKind = 'income' | 'expense' | 'transfer';

const NOUNS: Record<OperationKind, string> = { income: 'доход', expense: 'расход', transfer: 'перевод' };
/** Глагол действия: с типом (мужской род) и без типа («операция»). */
const VERBS: Record<string, [string, string]> = {
  create: ['Добавлен', 'Добавлена'],
  update: ['Изменён', 'Изменена'],
  delete: ['Удалён', 'Удалена'],
  restore: ['Восстановлен', 'Восстановлена'],
};

export const isOperationKind = (v: unknown): v is OperationKind => v === 'income' || v === 'expense' || v === 'transfer';

/** «Добавлен доход», «Изменён расход»; без типа — «Изменена операция»; неизвестное действие — null. */
export function operationActionTitle(action: string, type: OperationKind | null): string | null {
  const verb = VERBS[action];
  if (!verb) return null;
  return type ? `${verb[0]} ${NOUNS[type]}` : `${verb[1]} операция`;
}

const isUndone = (v: unknown): v is { id: number; action: string; type: unknown } =>
  typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'number' && typeof (v as { action?: unknown }).action === 'string';

/** Отменённые действия записи «Отмена» (diff.undone, R10); неизвестный вид — null. */
export function undoneActions(diff: Record<string, unknown> | null): { id: number; title: string }[] | null {
  const list = diff?.undone;
  if (!Array.isArray(list) || list.length === 0 || !list.every(isUndone)) return null;
  return list.map((u) => ({ id: u.id, title: (operationActionTitle(u.action, isOperationKind(u.type) ? u.type : null) ?? u.action).toLowerCase() }));
}

export function fetchUndoPreview(companyId: number, entryId: number): Promise<UndoPreview> {
  return api<UndoPreview>(`/companies/${companyId}/audit/${entryId}/undo`);
}

export function runUndo(companyId: number, entryId: number, ids: number[]): Promise<UndoResult> {
  return api<UndoResult>(`/companies/${companyId}/audit/${entryId}/undo`, { method: 'POST', body: { ids } });
}

/** «Отменятся 2 действия. Операция вернётся в состояние до них.» */
export function undoConfirmText(n: number): string {
  const verb = pluralRu(n, 'Отменится', 'Отменятся', 'Отменятся');
  const noun = pluralRu(n, 'действие', 'действия', 'действий');
  return `${verb} ${n} ${noun}. Операция вернётся в состояние до ${n === 1 ? 'него' : 'них'}.`;
}

/** Строка списка в окне: «Изменён расход · 06.10.2026, 17:00:00 · Админ». */
export function undoEntryLine(e: UndoPreviewEntry, timeZone: string): string {
  return `${operationActionTitle(e.action, e.type) ?? e.action} · ${formatDateTimeSec(e.at, timeZone)} · ${e.userName ?? 'Система'}`;
}

/** Итог после отмены: «Отменено 2 действия». */
export function undoDoneText(n: number): string {
  return `Отменено ${n} ${pluralRu(n, 'действие', 'действия', 'действий')}`;
}
