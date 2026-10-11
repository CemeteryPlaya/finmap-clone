import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import type { OperationType } from './journal-filter';
import { pluralRu } from './journal-format';

/** Не больше операций за одно массовое действие — как у сервера (BULK_MAX плана 5a). */
export const BULK_MAX = 500;

/** Тело POST /companies/:cid/operations/bulk без списка id (план 5a). */
export type BulkAction =
  | { action: 'setCategory'; categoryId: number }
  | { action: 'setProject'; projectId: number }
  | { action: 'setCounterparty'; counterpartyId: number }
  | { action: 'delete' }
  | { action: 'restore' };

export interface BulkResult {
  changed: number[];
  skipped: { id: number; reason: string }[];
}

const TITLES: Record<BulkAction['action'], string> = {
  setCategory: 'Категория',
  setProject: 'Проект',
  setCounterparty: 'Контрагент',
  delete: 'Удаление',
  restore: 'Отмена удаления',
};

export interface BulkSummary {
  text: string;
  reasons: { reason: string; count: number }[];
}

/** Итог массового действия (§7): «Категория: изменено 3, пропущено 2» и причины пропуска с числом операций. */
export function bulkSummary(action: BulkAction['action'], r: BulkResult): BulkSummary {
  const counts = new Map<string, number>();
  for (const s of r.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return {
    text: `${TITLES[action]}: изменено ${r.changed.length}, пропущено ${r.skipped.length}`,
    reasons: [...counts].map(([reason, count]) => ({ reason, count })),
  };
}

/** «Изменить данные» (§5.5 этапа 1.5): действия, которые назначают значение. */
export type BulkEditAction = Extract<BulkAction, { action: 'setCategory' | 'setProject' | 'setCounterparty' }>;

/** Поля окна «Изменить данные»; null — «Не менять». */
export interface BulkEditValues {
  counterpartyId: number | null;
  categoryId: number | null;
  projectId: number | null;
}

/** Действия для заполненных полей в порядке выполнения (§5.5): категория, проект, контрагент. */
export function bulkEditActions(v: BulkEditValues): BulkEditAction[] {
  const actions: BulkEditAction[] = [];
  if (v.categoryId !== null) actions.push({ action: 'setCategory', categoryId: v.categoryId });
  if (v.projectId !== null) actions.push({ action: 'setProject', projectId: v.projectId });
  if (v.counterpartyId !== null) actions.push({ action: 'setCounterparty', counterpartyId: v.counterpartyId });
  return actions;
}

/**
 * Итог «Изменить данные» (§5.5): по каждому полю — «Категория: изменено N, пропущено M»; если полей несколько,
 * причины пропуска подписаны полем. Сбой — «Проект: ошибка — …», поля после него — «Контрагент: не выполнено».
 */
export function bulkEditSummary(
  done: readonly { action: BulkEditAction['action']; result: BulkResult }[],
  failed: { action: BulkEditAction['action']; message: string } | null,
  notRun: readonly BulkEditAction['action'][],
): BulkSummary {
  const several = done.length + (failed ? 1 : 0) + notRun.length > 1;
  const parts = done.map((d) => ({ action: d.action, summary: bulkSummary(d.action, d.result) }));
  return {
    text: [
      ...parts.map((p) => p.summary.text),
      ...(failed ? [`${TITLES[failed.action]}: ошибка — ${failed.message}`] : []),
      ...notRun.map((a) => `${TITLES[a]}: не выполнено`),
    ].join('. '),
    reasons: parts.flatMap((p) => p.summary.reasons.map((r) => (several ? { reason: `${TITLES[p.action]}: ${r.reason}`, count: r.count } : r))),
  };
}

const TYPE_TITLES: Record<OperationType, string> = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' };

/**
 * Итог выделения в полосе действий (§5.5 этапа 1.5): по каждому типу в порядке Доход, Расход, Перевод —
 * «Доход • 2 платежа • 45 666 ₸», части через « · »; сумма — Σ baseAmount в базовой валюте компании.
 */
export function selectionTotals(items: readonly { type: OperationType; baseAmount: number }[], baseCurrency: string): string {
  return (['income', 'expense', 'transfer'] as const)
    .flatMap((type) => {
      const ofType = items.filter((i) => i.type === type);
      if (ofType.length === 0) return [];
      const sum = ofType.reduce((s, i) => s + i.baseAmount, 0);
      return [`${TYPE_TITLES[type]} • ${ofType.length} ${pluralRu(ofType.length, 'платёж', 'платежа', 'платежей')} • ${formatMoney(sum, baseCurrency, MONEY_SCREEN)}`];
    })
    .join(' · ');
}
