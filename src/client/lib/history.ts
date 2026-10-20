import { formatDateTimeSec } from '../../shared/dates';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import { ACTION_LABELS, diffRows, type DiffRow } from './audit-format';
import { isOperationKind, operationActionTitle, undoneActions, type OperationKind } from './operation-undo';
import type { AuditEntry } from './queries';

/** Поля операции в записи правки — по-русски. */
export const OPERATION_FIELD_LABELS: Record<string, string> = {
  type: 'Тип',
  paidAt: 'Дата',
  accrualDate: 'Дата сделки',
  accountId: 'Счёт',
  toAccountId: 'Счёт зачисления',
  amount: 'Сумма',
  toAmount: 'Сумма зачисления',
  counterpartyId: 'Контрагент',
  comment: 'Комментарий',
  lines: 'Категория и проект',
  tagIds: 'Теги',
};

/**
 * Вторая строка записи правки: смена типа отдельно — «Тип: Расход → Перевод» (§10.1 этапа 1.5), затем остальные поля
 * по-русски — «Изменено: Счёт зачисления, Контрагент». null — показывать нечего.
 */
function changesText(rows: readonly DiffRow[]): string | null {
  const typeRow = rows.find((r) => r.field === 'type');
  const others = rows.filter((r) => r.field !== 'type');
  const parts = [
    ...(typeRow ? [`Тип: ${typeRow.before} → ${typeRow.after}`] : []),
    ...(others.length > 0 ? [`Изменено: ${others.map((r) => OPERATION_FIELD_LABELS[r.field] ?? r.field).join(', ')}`] : []),
  ];
  return parts.length > 0 ? parts.join('. ') : null;
}

export interface HistoryItem {
  /** id записи истории. */
  id: number;
  operationId: number | null;
  /** «Добавлен доход», «Изменён расход», «Удалён перевод», «Восстановлена операция». */
  title: string;
  /** Тип операции — цвет суммы; null у старых записей без типа. */
  type: OperationKind | null;
  /** «₸ 1 317» — у добавления, удаления и восстановления, если счёт известен. */
  amount: string | null;
  account: string | null;
  /** У правки — «Изменено: Сумма, Комментарий». */
  changes: string | null;
  /** «Админ · 04.10.2026, 10:32:15». */
  meta: string;
  /** Открыть в форме можно, если по ленте операция не удалена (последнее — не удаление и не отмена, после которой её нет). */
  openable: boolean;
  /** Действие отменено (пометка «Отменено»). */
  undone: boolean;
  /** Есть кнопка «Отмена» (сервер: решение 3 и R5 плана 2026-10-20). */
  undoable: boolean;
}

/**
 * Записи панели «История действий» (§3.4 этапа 1.5). entries — от новых к старым, как отдаёт сервер:
 * первое встреченное действие с операцией — последнее по времени.
 */
export function historyItems(
  entries: readonly AuditEntry[],
  ctx: { accounts: ReadonlyMap<number, { name: string; currency: string }>; timeZone: string },
): HistoryItem[] {
  // удалена ли операция по последнему действию в ленте: удаление или «Отмена», после которой операции нет
  const deleted = new Map<number, boolean>();
  for (const e of entries) {
    if (e.entityId === null || deleted.has(e.entityId)) continue;
    deleted.set(e.entityId, e.action === 'delete' || (e.action === 'undo' && e.diff?.deleted === true));
  }

  return entries.map((e) => {
    const diff = e.diff ?? {};
    const type = isOperationKind(diff.type) ? diff.type : null;
    const undo = e.action === 'undo';
    const title = undo ? 'Отмена' : (operationActionTitle(e.action, type) ?? `${ACTION_LABELS[e.action] ?? e.action}: операция`);
    const account = typeof diff.accountId === 'number' ? ctx.accounts.get(diff.accountId) : undefined;
    const amount = e.action !== 'update' && typeof diff.amount === 'number' && account ? formatMoney(diff.amount, account.currency, MONEY_SCREEN_BEFORE) : null;
    const rows = e.action === 'update' ? diffRows(e.diff, 'operation') : null;
    const undone = undo ? undoneActions(e.diff) : null;
    const changes = rows ? changesText(rows) : undone ? `Отменено: ${undone.map((u) => u.title).join(', ')}` : null;
    return {
      id: e.id,
      operationId: e.entityId,
      title,
      type,
      amount,
      account: account?.name ?? null,
      changes,
      meta: `${e.userName ?? 'Система'} · ${formatDateTimeSec(e.at, ctx.timeZone)}`,
      openable: e.entityId !== null && deleted.get(e.entityId) !== true,
      undone: e.undoneBy !== null,
      undoable: e.undoable,
    };
  });
}
