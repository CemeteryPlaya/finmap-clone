import { getCurrency } from '../../shared/currencies';
import { timeOfDay } from '../../shared/dates';
import { amountInputText, dayOf } from './journal-format';
import type { OperationBody, OperationDraft } from './operation-form';
import { newLine } from './split';

/** Операция из `GET /companies/:cid/operations/:id` (план 4a): строка операции, строки разбиения и теги. */
export interface OperationRecord {
  id: number;
  type: OperationDraft['type'];
  paidAt: string;
  accrualDate: string | null;
  accountId: number;
  amount: number;
  toAccountId: number | null;
  toAmount: number | null;
  counterpartyId: number | null;
  comment: string | null;
  version: number;
  deletedAt: string | null;
  lines: { categoryId: number | null; projectId: number | null; amount: number }[];
  tagIds: number[];
}

type AccountLike = { id: number; currency: string; archivedAt: string | null };

const minorOf = (accounts: ReadonlyMap<number, AccountLike>, id: number | null) =>
  getCurrency(id === null ? 'KZT' : (accounts.get(id)?.currency ?? 'KZT')).minorUnits;

/**
 * Операция → черновик формы. Больше одной строки у дохода или расхода — разбиение в суммах;
 * у перевода строка только с проектом. Сумма зачисления — только у перевода между валютами.
 */
export function draftFromOperation(op: OperationRecord, accounts: ReadonlyMap<number, AccountLike>, timeZone: string): OperationDraft {
  const minor = minorOf(accounts, op.accountId);
  const from = accounts.get(op.accountId)?.currency;
  const to = op.toAccountId === null ? undefined : accounts.get(op.toAccountId)?.currency;
  const single = op.lines.length === 1 ? op.lines[0]! : null;
  const split = op.type !== 'transfer' && op.lines.length > 1;
  const paidDate = dayOf(op.paidAt, timeZone);
  return {
    type: op.type,
    accountId: op.accountId,
    amount: amountInputText(op.amount, minor),
    toAccountId: op.toAccountId,
    toAmount: op.toAmount !== null && to !== undefined && to !== from ? amountInputText(op.toAmount, minorOf(accounts, op.toAccountId)) : '',
    paidDate,
    // поле показывает время операции, но оно не «задано руками»: без правки времени paidAt не меняется (§2.3)
    paidTime: timeOfDay(op.paidAt, timeZone),
    paidTimeSet: false,
    accrualOn: op.accrualDate !== null,
    accrualDate: op.accrualDate ?? paidDate,
    categoryId: single?.categoryId ?? null,
    projectId: single?.projectId ?? null,
    counterpartyId: op.counterpartyId,
    tagIds: [...op.tagIds],
    comment: op.comment ?? '',
    split: split
      ? { mode: 'amount', lines: op.lines.map((l) => newLine({ categoryId: l.categoryId, projectId: l.projectId, value: amountInputText(l.amount, minor) })) }
      : null,
  };
}

/** Тело PATCH: изменённые поля и версия. */
export type OperationPatch = Partial<Omit<OperationBody, 'type'>> & { version: number };

const sameLines = (a: OperationRecord['lines'], b: OperationBody['lines']) =>
  a.length === b.length && a.every((l, i) => l.categoryId === b[i]!.categoryId && l.projectId === b[i]!.projectId && l.amount === b[i]!.amount);
const sameIds = (a: readonly number[], b: readonly number[]) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

/**
 * Изменённые поля для PATCH (итоги плана 4a, п. 1): `null` в `toAccountId`/`toAmount` схема правки не принимает,
 * а прежняя сумма зачисления вместе с новой суммой у перевода в одной валюте дала бы INVARIANT_4.
 * Дата оплаты отправляется, только если сменились дата или минуты в APP_TIMEZONE (§2.3 этапа 1.5): правка без смены времени не трогает секунды. У перевода между валютами сервер
 * сбрасывает сумму зачисления при смене суммы или счетов, если её нет в запросе, — поэтому тогда она уходит всегда.
 * null — менять нечего.
 */
export function patchBody(op: OperationRecord, body: OperationBody, timeZone: string): OperationPatch | null {
  const patch: OperationPatch = { version: op.version };
  const minute = (iso: string) => `${dayOf(iso, timeZone)} ${timeOfDay(iso, timeZone)}`;
  if (minute(body.paidAt) !== minute(op.paidAt)) patch.paidAt = body.paidAt;
  if (body.accrualDate !== op.accrualDate) patch.accrualDate = body.accrualDate;
  if (body.accountId !== op.accountId) patch.accountId = body.accountId;
  if (body.amount !== op.amount) patch.amount = body.amount;
  if (body.toAccountId !== null && body.toAccountId !== op.toAccountId) patch.toAccountId = body.toAccountId;
  if (body.toAmount !== null && (body.toAmount !== op.toAmount || 'amount' in patch || 'accountId' in patch || 'toAccountId' in patch)) {
    patch.toAmount = body.toAmount;
  }
  if (body.counterpartyId !== op.counterpartyId) patch.counterpartyId = body.counterpartyId;
  if (body.comment !== op.comment) patch.comment = body.comment;
  if (!sameLines(op.lines, body.lines)) patch.lines = body.lines;
  if (!sameIds(op.tagIds, body.tagIds)) patch.tagIds = body.tagIds;
  return Object.keys(patch).length > 1 ? patch : null;
}

/** Неархивные элементы справочников: копия операции может ссылаться только на них (инвариант 7). */
export interface Available {
  accounts: ReadonlySet<number>;
  categories: ReadonlySet<number>;
  projects: ReadonlySet<number>;
  counterparties: ReadonlySet<number>;
  tags: ReadonlySet<number>;
}

/**
 * Черновик без архивных ссылок: новая операция не может выбрать архивный счёт, категорию, проект, контрагента
 * или тег (инвариант 7) — их место остаётся пустым. Для «Дублировать» и «Сохранить и создать похожий» после правки.
 */
export function withoutArchived(draft: OperationDraft, available: Available): OperationDraft {
  const keep = (set: ReadonlySet<number>, id: number | null) => (id !== null && set.has(id) ? id : null);
  return {
    ...draft,
    accountId: keep(available.accounts, draft.accountId),
    toAccountId: keep(available.accounts, draft.toAccountId),
    categoryId: keep(available.categories, draft.categoryId),
    projectId: keep(available.projects, draft.projectId),
    counterpartyId: keep(available.counterparties, draft.counterpartyId),
    tagIds: draft.tagIds.filter((id) => available.tags.has(id)),
    split: draft.split && {
      ...draft.split,
      lines: draft.split.lines.map((l) => newLine({ categoryId: keep(available.categories, l.categoryId), projectId: keep(available.projects, l.projectId), value: l.value })),
    },
  };
}

/** «Дублировать платёж» (§7, §2.3 этапа 1.5): новая операция с теми же значениями, без архивных ссылок, «сегодня» и живое время. */
export function duplicateDraft(draft: OperationDraft, available: Available, today: string): OperationDraft {
  return { ...withoutArchived(draft, available), paidDate: today, paidTime: '', paidTimeSet: false };
}

/** Архивный счёт, который затрагивает операция: сумму, дату оплаты и счета менять нельзя, удалить нельзя (инвариант 7). */
export function archivedAccountOf(op: Pick<OperationRecord, 'accountId' | 'toAccountId'>, accounts: ReadonlyMap<number, AccountLike & { name: string }>) {
  return [op.accountId, op.toAccountId].map((id) => (id === null ? undefined : accounts.get(id))).find((a) => a?.archivedAt) ?? null;
}
