import { getCurrency } from '../../shared/currencies';
import { timeOfDay } from '../../shared/dates';
import { amountInputText, dayOf, pluralRu } from './journal-format';
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
  /** Оплаты закупок расхода с номерами поступлений (§6.1 спецификации «Склад»); у операций без оплат — пусто или нет. */
  stockPayments?: { docId: number; number: string; amount: number }[];
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
    // дата существующей операции остаётся (R5): за «сегодня» она не следует
    paidDateSet: true,
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
    stockPayments: (op.stockPayments ?? []).map((p) => ({ docId: p.docId, amount: amountInputText(p.amount, minor) })),
  };
}

/** Тело PATCH: изменённые поля и версия; `type: 'transfer'` — «Изменить в перевод» (§10.1 этапа 1.5). */
export type OperationPatch = Partial<Omit<OperationBody, 'type'>> & { version: number; type?: 'transfer' };

const sameLines = (a: OperationRecord['lines'], b: OperationBody['lines']) =>
  a.length === b.length && a.every((l, i) => l.categoryId === b[i]!.categoryId && l.projectId === b[i]!.projectId && l.amount === b[i]!.amount);
const samePayments = (a: NonNullable<OperationRecord['stockPayments']>, b: OperationBody['stockPayments']) => {
  const key = (l: readonly { docId: number; amount: number }[]) => JSON.stringify([...l].sort((x, y) => x.docId - y.docId).map((p) => [p.docId, p.amount]));
  return key(a) === key(b);
};
const sameIds =(a: readonly number[], b: readonly number[]) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

/**
 * Изменённые поля для PATCH (итоги плана 4a, п. 1): `null` в `toAccountId`/`toAmount` схема правки не принимает,
 * а прежняя сумма зачисления вместе с новой суммой у перевода в одной валюте дала бы INVARIANT_4.
 * Дата оплаты отправляется, только если сменились дата или минуты в APP_TIMEZONE (§2.3 этапа 1.5): правка без смены времени не трогает секунды. У перевода между валютами сервер
 * сбрасывает сумму зачисления при смене суммы или счетов, если её нет в запросе, — поэтому тогда она уходит всегда.
 * null — менять нечего.
 */
export function patchBody(op: OperationRecord, body: OperationBody, timeZone: string): OperationPatch | null {
  const patch: OperationPatch = { version: op.version };
  // «Изменить в перевод» (§10.1): смена типа; явные поля перевода (счёт зачисления, контрагент null, строки, дата сделки null)
  // уходят ниже как обычные различия с операцией
  if (body.type === 'transfer' && op.type !== 'transfer') patch.type = 'transfer';
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
  if (!samePayments(op.stockPayments ?? [], body.stockPayments)) patch.stockPayments = body.stockPayments;
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
  // оплата закупки остаётся у исходного расхода: копия никого не оплачивает
  return { ...withoutArchived(draft, available), paidDate: today, paidDateSet: false, paidTime: '', paidTimeSet: false, stockPayments: [] };
}

/** Архивный счёт, который затрагивает операция: сумму, дату оплаты и счета менять нельзя, удалить нельзя (инвариант 7). */
export function archivedAccountOf(op: Pick<OperationRecord, 'accountId' | 'toAccountId'>, accounts: ReadonlyMap<number, AccountLike & { name: string }>) {
  return [op.accountId, op.toAccountId].map((id) => (id === null ? undefined : accounts.get(id))).find((a) => a?.archivedAt) ?? null;
}

/** Названия для списка потерь «Изменить в перевод» (§6.8 этапа 1.5): категория и контрагент по id; не найдено — undefined. */
export interface ConvertNames {
  category: (id: number) => string | undefined;
  counterparty: (id: number) => string | undefined;
}

export interface ConvertResult {
  /** Черновик перевода: тип, счета, проект; теги, комментарий, дата и время — прежние. */
  draft: OperationDraft;
  /** Что будет убрано, по порядку: категория, контрагент, разбиение, дата сделки. Пусто — подтверждение не нужно. */
  losses: string[];
  /** Доход: прежняя сумма (текст поля) — «Сумма зачисления» на прежнем счёте (см. pickConvertedFrom); у расхода — null. */
  carried: string | null;
}

const named = (what: string, name: string | undefined) => (name ? `${what} «${name}»` : what);

/**
 * «Изменить в перевод» (§6.8 этапа 1.5): черновик дохода или расхода → черновик перевода на месте. Расход на счёте A —
 * «Со счёта» = A, «На счёт» пусто; доход на счёте A — «На счёт» = A, «Со счёта» пусто, прежняя сумма — и сумма, и
 * «Сумма зачисления» (её место решает выбор «Со счёта», pickConvertedFrom). Проект остаётся, только если он один у всех
 * строк. Категория, контрагент, разбиение и дата сделки убираются — они и есть список потерь для подтверждения.
 * Работает с текущим черновиком: несохранённые правки формы переходят в перевод. Перевод возвращается как есть.
 */
export function convertToTransferDraft(draft: OperationDraft, names: ConvertNames): ConvertResult {
  if (draft.type === 'transfer') return { draft, losses: [], carried: null };
  const losses: string[] = [];
  if (!draft.split && draft.categoryId !== null) losses.push(named('категория', names.category(draft.categoryId)));
  if (draft.counterpartyId !== null) losses.push(named('контрагент', names.counterparty(draft.counterpartyId)));
  if (draft.split) {
    const n = draft.split.lines.length;
    losses.push(`разбиение на ${n} ${pluralRu(n, 'строку', 'строки', 'строк')}`);
  }
  if (draft.accrualOn) losses.push('дата сделки');
  if (draft.stockPayments.length > 0) losses.push('оплата закупки');
  const projects = draft.split ? [...new Set(draft.split.lines.map((l) => l.projectId))] : [draft.projectId];
  const income = draft.type === 'income';
  return {
    draft: {
      ...draft,
      type: 'transfer',
      accountId: income ? null : draft.accountId,
      toAccountId: income ? draft.accountId : null,
      toAmount: income ? draft.amount : '',
      categoryId: null,
      projectId: projects.length === 1 ? projects[0]! : null,
      counterpartyId: null,
      accrualOn: false,
      split: null,
      stockPayments: [],
    },
    losses,
    carried: income ? draft.amount : null,
  };
}

/** Текст подтверждения «Изменить в перевод?»: «Будут убраны: категория «Аренда», контрагент «Алина», дата сделки.» */
export function convertQuestion(losses: readonly string[]): string {
  return `Будут убраны: ${losses.join(', ')}.`;
}

/**
 * Выбор «Со счёта» у дохода, изменённого в перевод (§6.8 этапа 1.5): прежняя сумма `carried` — сумма зачисления. Счёт в
 * другой валюте, чем «На счёт», очищает сумму списания, если её не меняли («Сумму» нужно ввести); в той же валюте пустая
 * сумма снова становится прежней. Набранную руками сумму выбор счёта не трогает.
 */
export function pickConvertedFrom(draft: OperationDraft, accountId: number | null, accounts: ReadonlyMap<number, { currency: string }>, carried: string): OperationDraft {
  const next = { ...draft, accountId };
  const from = accountId === null ? undefined : accounts.get(accountId)?.currency;
  const to = draft.toAccountId === null ? undefined : accounts.get(draft.toAccountId)?.currency;
  if (from === undefined || to === undefined) return next;
  if (from !== to) return draft.amount === carried ? { ...next, amount: '' } : next;
  return draft.amount === '' ? { ...next, amount: carried } : next;
}

/**
 * Причина, по которой строка «Изменить в перевод» недоступна (§6.7 строка 4, §11 этапа 1.5): операция на архивном счёте
 * (инвариант 7) или в компании нет другого активного счёта — перевод некуда направить. undefined — доступна.
 */
export function convertBlockedHint(
  locked: { name: string } | null,
  accounts: readonly { id: number; archivedAt: string | null }[],
  accountId: number | null,
): string | undefined {
  if (locked) return `Изменить в перевод нельзя: счёт в архиве («${locked.name}»)`;
  if (!accounts.some((a) => !a.archivedAt && a.id !== accountId)) return 'Изменить в перевод нельзя: нет другого счёта';
  return undefined;
}
