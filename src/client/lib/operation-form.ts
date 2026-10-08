import { evaluateAmount } from '../../shared/calc';
import { getCurrency } from '../../shared/currencies';
import { isValidDate, startOfDayUtc, zoneOffsetMs } from '../../shared/dates';
import { DEC_ONE, divDec, roundSignificant } from '../../shared/decimal';
import type { OperationType } from './journal-filter';
import { similarSplit, splitLines, splitResult, type SplitDraft } from './split';

/**
 * Черновик формы операции (§7 «Форма операции»): то, что видит пользователь. Суммы — текст поля (в нём может
 * быть выражение калькулятора), даты — календарные `YYYY-MM-DD` в APP_TIMEZONE.
 */
export interface OperationDraft {
  type: OperationType;
  accountId: number | null;
  amount: string;
  /** Перевод: счёт зачисления. */
  toAccountId: number | null;
  /** Перевод между валютами: «Сумма зачисления». */
  toAmount: string;
  paidDate: string;
  /** «Дата сделки отличается». */
  accrualOn: boolean;
  accrualDate: string;
  categoryId: number | null;
  projectId: number | null;
  counterpartyId: number | null;
  tagIds: number[];
  comment: string;
  /** «Разделить» (только доход и расход): строки вместо статьи и проекта. null — без разбиения. */
  split: SplitDraft | null;
}

/** Тело POST /companies/:cid/operations (план 4a, `operationCreateSchema`). */
export interface OperationBody {
  type: OperationType;
  paidAt: string;
  accrualDate: string | null;
  accountId: number;
  amount: number;
  toAccountId: number | null;
  toAmount: number | null;
  counterpartyId: number | null;
  comment: string | null;
  lines: { categoryId: number | null; projectId: number | null; amount: number }[];
  tagIds: number[];
}

export interface AccountLike {
  id: number;
  currency: string;
}

export interface DraftContext {
  accounts: ReadonlyMap<number, AccountLike>;
  /** «Сегодня» в APP_TIMEZONE: выбрать будущий день нельзя (инвариант 6). */
  today: string;
  timeZone: string;
  now: Date;
  /** Откуда взять время суток для paidAt: у новой операции — «сейчас», у существующей — её прежнее время. */
  timeOfDayFrom: Date;
}

export type BuildResult = { ok: true; body: OperationBody } | { ok: false; errors: Record<string, string> };

export const COMMENT_MAX = 2000;

export function emptyDraft(type: OperationType, today: string, accountId: number | null = null): OperationDraft {
  return {
    type,
    accountId,
    amount: '',
    toAccountId: null,
    toAmount: '',
    paidDate: today,
    accrualOn: false,
    accrualDate: today,
    categoryId: null,
    projectId: null,
    counterpartyId: null,
    tagIds: [],
    comment: '',
    split: null,
  };
}

/** Смена типа в новой операции: статья другого вида и контрагент у перевода не переносятся. */
export function changeType(draft: OperationDraft, type: OperationType): OperationDraft {
  if (type === draft.type) return draft;
  return {
    ...draft,
    type,
    categoryId: null,
    split: null,
    counterpartyId: type === 'transfer' ? null : draft.counterpartyId,
    toAccountId: type === 'transfer' ? draft.toAccountId : null,
    toAmount: type === 'transfer' ? draft.toAmount : '',
  };
}

/** «Сохранить и создать похожий» (§7): те же значения, кроме суммы, комментария и файлов (суммы строк разбиения — тоже). */
export function similarDraft(draft: OperationDraft): OperationDraft {
  return { ...draft, amount: '', toAmount: '', comment: '', split: draft.split && similarSplit(draft.split) };
}

const DAY_MS = 86_400_000;

/**
 * Момент оплаты для даты из формы: дата `date` и время суток момента `ref` (в поясе приложения), но не позже `now`.
 * Новая операция за сегодня — ровно «сейчас»; за прошлый день — тот же час; правка даты сохраняет прежнее время.
 */
export function paidAtFor(date: string, ref: Date, now: Date, timeZone: string): string {
  const wall = ref.getTime() + zoneOffsetMs(ref.getTime(), timeZone);
  const msOfDay = ((wall % DAY_MS) + DAY_MS) % DAY_MS;
  const t = Date.parse(startOfDayUtc(date, timeZone)) + msOfDay;
  return new Date(Math.min(t, now.getTime())).toISOString();
}

/** Сумма поля → минимальные единицы (> 0) или текст ошибки. */
export function positiveAmount(text: string, minorUnits: number): { ok: true; minor: number } | { ok: false; error: string } {
  const r = evaluateAmount(text, minorUnits);
  if (!r.ok) return r;
  if (r.minor <= 0) return { ok: false, error: 'Сумма больше нуля' };
  return r;
}

/**
 * Черновик → тело запроса создания операции; ошибки — по полям формы (ключи как у ответа сервера:
 * `accountId`, `amount`, `toAccountId`, `toAmount`, `paidAt`, `accrualDate`, `comment`).
 */
export function buildBody(draft: OperationDraft, ctx: DraftContext): BuildResult {
  const errors: Record<string, string> = {};
  const account = draft.accountId === null ? undefined : ctx.accounts.get(draft.accountId);
  if (!account) errors.accountId = 'Выберите счёт';

  let amount = 0;
  if (account) {
    const r = positiveAmount(draft.amount, getCurrency(account.currency).minorUnits);
    if (r.ok) amount = r.minor;
    else errors.amount = r.error;
  }

  // разбиение: сохранить можно, только когда остаток равен 0 (§7)
  const split = draft.type !== 'transfer' && draft.split ? draft.split : null;
  const result = split && account ? splitResult(split, errors.amount ? null : amount, getCurrency(account.currency).minorUnits) : null;
  if (split && result && !errors.amount && !result.ok) {
    errors.lines = result.left !== 0 ? 'Распределите всю сумму: остаток должен быть 0' : 'Проверьте строки разбиения';
  }

  let toAccountId: number | null = null;
  let toAmount: number | null = null;
  if (draft.type === 'transfer') {
    const to = draft.toAccountId === null ? undefined : ctx.accounts.get(draft.toAccountId);
    if (!to) errors.toAccountId = 'Выберите счёт зачисления';
    else if (to.id === draft.accountId) errors.toAccountId = 'Выберите другой счёт';
    else {
      toAccountId = to.id;
      if (account && to.currency !== account.currency) {
        if (draft.toAmount.trim() === '') errors.toAmount = 'Укажите сумму зачисления';
        else {
          const r = positiveAmount(draft.toAmount, getCurrency(to.currency).minorUnits);
          if (r.ok) toAmount = r.minor;
          else errors.toAmount = r.error;
        }
      }
    }
  }

  if (!isValidDate(draft.paidDate)) errors.paidAt = 'Укажите дату оплаты';
  else if (draft.paidDate > ctx.today) errors.paidAt = 'Дата оплаты в будущем — так нельзя';
  // у перевода даты сделки нет (§7): переключатель есть только у дохода и расхода
  const accrual = draft.accrualOn && draft.type !== 'transfer';
  if (accrual && !isValidDate(draft.accrualDate)) errors.accrualDate = 'Укажите дату сделки';
  const comment = draft.comment.trim();
  if (comment.length > COMMENT_MAX) errors.comment = `Не длиннее ${COMMENT_MAX} символов`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const transfer = draft.type === 'transfer';
  return {
    ok: true,
    body: {
      type: draft.type,
      paidAt: paidAtFor(draft.paidDate, ctx.timeOfDayFrom, ctx.now, ctx.timeZone),
      accrualDate: accrual ? draft.accrualDate : null,
      accountId: account!.id,
      amount,
      toAccountId,
      toAmount,
      counterpartyId: transfer ? null : draft.counterpartyId,
      comment: comment || null,
      // у перевода строка только с проектом (§4.5); у дохода и расхода — строки разбиения или одна на всю сумму
      lines: transfer
        ? draft.projectId === null
          ? []
          : [{ categoryId: null, projectId: draft.projectId, amount }]
        : split && result
          ? splitLines(split, result)
          : [{ categoryId: draft.categoryId, projectId: draft.projectId, amount }],
      tagIds: [...draft.tagIds],
    },
  };
}

const toDec = (minor: number, currency: string) => (BigInt(minor) * DEC_ONE) / 10n ** BigInt(getCurrency(currency).minorUnits);

/**
 * Курс перевода между валютами из двух сумм (§7: «вычисленный курс»): за единицу более дорогой валюты,
 * 10 значащих цифр — «1 USD = 500 KZT», а не «1 KZT = 0,002 USD». null — суммы не заданы или валюта одна.
 */
export function transferRateText(amount: number, from: string, toAmount: number, to: string): string | null {
  if (amount <= 0 || toAmount <= 0 || from === to) return null;
  const a = toDec(amount, from);
  const b = toDec(toAmount, to);
  const [unit, other, num, den] = b >= a ? [from, to, b, a] : [to, from, a, b];
  return `1 ${unit} = ${roundSignificant(divDec(num, den)).replace('.', ',')} ${other}`;
}
