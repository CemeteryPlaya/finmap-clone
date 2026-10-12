import { formatDateTimeSec } from '../../shared/dates';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import { ACTION_LABELS, diffRows, type DiffRow } from './audit-format';
import type { AuditEntry } from './queries';

type OperationKind = 'income' | 'expense' | 'transfer';

const NOUNS: Record<OperationKind, string> = { income: 'доход', expense: 'расход', transfer: 'перевод' };
/** Глагол действия: с типом (мужской род) и без типа («операция»). */
const VERBS: Record<string, [string, string]> = {
  create: ['Добавлен', 'Добавлена'],
  update: ['Изменён', 'Изменена'],
  delete: ['Удалён', 'Удалена'],
  restore: ['Восстановлен', 'Восстановлена'],
};

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
  /** Открыть в форме можно, если последнее действие с операцией в ленте — не удаление. */
  openable: boolean;
}

const isKind = (v: unknown): v is OperationKind => v === 'income' || v === 'expense' || v === 'transfer';

/**
 * Записи панели «История действий» (§3.4 этапа 1.5). entries — от новых к старым, как отдаёт сервер:
 * первое встреченное действие с операцией — последнее по времени.
 */
export function historyItems(
  entries: readonly AuditEntry[],
  ctx: { accounts: ReadonlyMap<number, { name: string; currency: string }>; timeZone: string },
): HistoryItem[] {
  const latest = new Map<number, string>();
  for (const e of entries) if (e.entityId !== null && !latest.has(e.entityId)) latest.set(e.entityId, e.action);

  return entries.map((e) => {
    const diff = e.diff ?? {};
    const type = isKind(diff.type) ? diff.type : null;
    const verb = VERBS[e.action];
    const title = verb ? (type ? `${verb[0]} ${NOUNS[type]}` : `${verb[1]} операция`) : `${ACTION_LABELS[e.action] ?? e.action}: операция`;
    const account = typeof diff.accountId === 'number' ? ctx.accounts.get(diff.accountId) : undefined;
    const amount = e.action !== 'update' && typeof diff.amount === 'number' && account ? formatMoney(diff.amount, account.currency, MONEY_SCREEN_BEFORE) : null;
    const rows = e.action === 'update' ? diffRows(e.diff, 'operation') : null;
    const changes = rows ? changesText(rows) : null;
    return {
      id: e.id,
      operationId: e.entityId,
      title,
      type,
      amount,
      account: account?.name ?? null,
      changes,
      meta: `${e.userName ?? 'Система'} · ${formatDateTimeSec(e.at, ctx.timeZone)}`,
      openable: e.entityId !== null && latest.get(e.entityId) !== 'delete',
    };
  });
}
