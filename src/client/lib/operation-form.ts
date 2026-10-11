import { evaluateAmount } from '../../shared/calc';
import { getCurrency } from '../../shared/currencies';
import { isValidDate, parseTimeInput, startOfDayUtc, zoneOffsetMs } from '../../shared/dates';
import { DEC_ONE, divDec, roundSignificant } from '../../shared/decimal';
import type { OperationType } from './journal-filter';
import { dayOf } from './journal-format';
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
  /**
   * Дату выбрали руками (или она у существующей операции). Нет — у новой операции дата следует за «сегодня» (§2.3 этапа 1.5):
   * форма, открытая до полуночи, сохраняет операцию на настоящий день. См. `paidDateOf`.
   */
  paidDateSet: boolean;
  /**
   * Время оплаты «ЧЧ:ММ» в APP_TIMEZONE (§2.3 этапа 1.5). Пусто — у новой операции «живое» время (поле показывает
   * «сейчас»); у правки — время операции. Используется при сохранении, только если `paidTimeSet`.
   */
  paidTime: string;
  /** Время задано руками: сохраняется дата + ЧЧ:ММ:00. Нет — «сейчас» у новой, прежнее время с секундами у правки. */
  paidTimeSet: boolean;
  /** «Дата сделки отличается». */
  accrualOn: boolean;
  accrualDate: string;
  categoryId: number | null;
  projectId: number | null;
  counterpartyId: number | null;
  tagIds: number[];
  comment: string;
  /** «Разделить» (только доход и расход): строки вместо категории и проекта. null — без разбиения. */
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
  /**
   * Правка: `paidAt` операции. Если дата не менялась и время не задано руками, он уходит в тело как есть — с секундами
   * и без «не позже сейчас» (§2.3 этапа 1.5): сохранённое время может быть позже «сейчас» этого устройства.
   */
  originalPaidAt?: string;
}

export type BuildResult = { ok: true; body: OperationBody } | { ok: false; errors: Record<string, string> };

export const COMMENT_MAX = 2000;

export function emptyDraft(type: OperationType, today: string, accountId: number | null = null, toAccountId: number | null = null): OperationDraft {
  return {
    type,
    accountId,
    amount: '',
    toAccountId: type === 'transfer' ? toAccountId : null,
    toAmount: '',
    paidDate: today,
    paidDateSet: false,
    paidTime: '',
    paidTimeSet: false,
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

/** Смена типа в новой операции: категория другого вида и контрагент у перевода не переносятся. */
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

/** Дата оплаты черновика: выбранная руками (или дата существующей операции), иначе — «сегодня» (R5 плана 1.5-3c). */
export function paidDateOf(draft: Pick<OperationDraft, 'paidDate' | 'paidDateSet'>, today: string): string {
  return draft.paidDateSet ? draft.paidDate : today;
}

/**
 * «+ Добавить и создать похожий» (§7, §2.3 этапа 1.5): те же значения, кроме суммы, комментария и файлов (суммы строк
 * разбиения — тоже). Дата остаётся, только если её или время выбрали руками (выручка за смену двумя операциями); иначе
 * дата снова следует за «сегодня», а время — «живое». `today` — «сегодня» на момент сохранения.
 */
export function similarDraft(draft: OperationDraft, today: string): OperationDraft {
  const keep = draft.paidDateSet || draft.paidTimeSet;
  return {
    ...draft,
    paidDate: keep ? paidDateOf(draft, today) : today,
    paidDateSet: keep,
    amount: '',
    toAmount: '',
    comment: '',
    split: draft.split && similarSplit(draft.split),
    paidTime: draft.paidTimeSet ? draft.paidTime : '',
  };
}

const DAY_MS = 86_400_000;

/**
 * Момент оплаты для даты из формы. С `time` («ЧЧ:ММ», задано руками, §2.3 этапа 1.5) — дата и ЧЧ:ММ:00 в поясе
 * приложения, без ограничения «не позже now»: проверка — в buildBody. Без `time` — время суток момента `ref`
 * (в поясе приложения), но не позже `now`: новая операция за сегодня — ровно «сейчас», за прошлый день — тот же час,
 * правка даты сохраняет прежнее время. Сложение «начало суток + время» верно для поясов без летнего времени —
 * Asia/Almaty такой (смещение берётся на дату операции: до 01.03.2024 UTC+6).
 */
export function paidAtFor(date: string, ref: Date, now: Date, timeZone: string, time?: string): string {
  const start = Date.parse(startOfDayUtc(date, timeZone));
  if (time !== undefined) {
    const [hours, minutes] = time.split(':').map(Number) as [number, number];
    return new Date(start + (hours * 60 + minutes) * 60_000).toISOString();
  }
  const wall = ref.getTime() + zoneOffsetMs(ref.getTime(), timeZone);
  const msOfDay = ((wall % DAY_MS) + DAY_MS) % DAY_MS;
  return new Date(Math.min(start + msOfDay, now.getTime())).toISOString();
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

  // время, заданное руками (§2.3 этапа 1.5): «ЧЧ:ММ», не позже «сейчас»
  const time = draft.paidTimeSet ? parseTimeInput(draft.paidTime) : undefined;
  // дата, которую не трогали, у новой операции — «сегодня» на момент сохранения (R5)
  const paidDate = paidDateOf(draft, ctx.today);
  // правка без смены даты: день операции может быть «позже» сегодняшнего по часам этого устройства — это не повод не сохранять
  const dateUnchanged = ctx.originalPaidAt !== undefined && dayOf(ctx.originalPaidAt, ctx.timeZone) === paidDate;
  if (!isValidDate(paidDate)) errors.paidAt = 'Укажите дату оплаты';
  else if (paidDate > ctx.today && !dateUnchanged) errors.paidAt = 'Дата оплаты в будущем — так нельзя';
  else if (time === null) errors.paidAt = 'Укажите время в виде ЧЧ:ММ';
  else if (time !== undefined && Date.parse(paidAtFor(paidDate, ctx.now, ctx.now, ctx.timeZone, time)) > ctx.now.getTime()) {
    errors.paidAt = 'Это время ещё не наступило';
  }
  // у перевода даты сделки нет (§7): переключатель есть только у дохода и расхода
  const accrual = draft.accrualOn && draft.type !== 'transfer';
  if (accrual && !isValidDate(draft.accrualDate)) errors.accrualDate = 'Укажите дату сделки';
  const comment = draft.comment.trim();
  if (comment.length > COMMENT_MAX) errors.comment = `Не длиннее ${COMMENT_MAX} символов`;

  // правка, дата та же, время не трогали — момент операции без изменений (секунды, без «не позже сейчас»)
  const original = !draft.paidTimeSet && dateUnchanged ? (ctx.originalPaidAt ?? null) : null;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const transfer = draft.type === 'transfer';
  return {
    ok: true,
    body: {
      type: draft.type,
      paidAt: original ?? paidAtFor(paidDate, ctx.timeOfDayFrom, ctx.now, ctx.timeZone, time ?? undefined),
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

/** Заголовки окна и текст главной кнопки по типу (§6.1, §6.9 этапа 1.5). */
const TYPE_TEXTS: Record<OperationType, { create: string; edit: string; submit: string }> = {
  income: { create: 'Новый доход', edit: 'Доход', submit: 'Добавить доход' },
  expense: { create: 'Новый расход', edit: 'Расход', submit: 'Добавить расход' },
  transfer: { create: 'Новый перевод', edit: 'Перевод', submit: 'Добавить перевод' },
};

/** Заголовок окна формы: «Новый доход» при создании, «Доход» при правке (§6.1 этапа 1.5). */
export function operationTitle(type: OperationType, editing: boolean): string {
  return editing ? TYPE_TEXTS[type].edit : TYPE_TEXTS[type].create;
}

/** Текст главной кнопки: «Добавить доход» при создании, «Сохранить изменения» при правке (§6.9 этапа 1.5). */
export function submitLabel(type: OperationType, editing: boolean): string {
  return editing ? 'Сохранить изменения' : TYPE_TEXTS[type].submit;
}

/** Подписи счёта и даты оплаты по типу, как в Finmap (§6.2 этапа 1.5); второй счёт перевода — «На счёт». */
export const FIELD_LABELS: Record<OperationType, { account: string; paidDate: string }> = {
  income: { account: 'На счёт', paidDate: 'Дата поступления денег' },
  expense: { account: 'Со счёта', paidDate: 'Указать дату списания' },
  transfer: { account: 'Со счёта', paidDate: 'Дата перевода денег' },
};

/**
 * Поле для фокуса при открытии формы (§6.2 этапа 1.5): у новой операции — первое пустое обязательное поле: счёт
 * (у перевода «Со счёта», затем «На счёт»), иначе сумма; при правке — сумма.
 */
export function initialFocusField(draft: Pick<OperationDraft, 'type' | 'accountId' | 'toAccountId'>, editing: boolean): 'accountId' | 'toAccountId' | 'amount' {
  if (editing) return 'amount';
  if (draft.accountId === null) return 'accountId';
  if (draft.type === 'transfer' && draft.toAccountId === null) return 'toAccountId';
  return 'amount';
}

/**
 * Время, которое показывает поле даты и времени (§2.3 этапа 1.5), — то, что сохранится: заданное руками; у новой
 * операции — «сейчас»; у правки с той же датой — время операции (даже если оно позже «сейчас» устройства); дату
 * перенесли на сегодня, а прежнее время ещё не наступило — «сейчас» (сохранится не позже него).
 */
export function shownPaidTime(
  draft: Pick<OperationDraft, 'paidDate' | 'paidTime' | 'paidTimeSet'>,
  nowTime: string,
  today: string,
  originalDate: string | null,
): string {
  if (draft.paidTimeSet) return draft.paidTime;
  if (draft.paidTime === '') return nowTime;
  if (draft.paidDate === originalDate) return draft.paidTime;
  return draft.paidDate === today && draft.paidTime > nowTime ? nowTime : draft.paidTime;
}

/** Месяцы строки «{Категория} за {месяц}»: именительный падеж со строчной (§6.7 строка 1а этапа 1.5). */
const MONTHS_LOWER = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/**
 * Строка «Зарплата за сентябрь» (§6.7 строка 1а этапа 1.5): месяц — из даты сделки, а если её нет — из даты оплаты
 * (тогда текст приглушён). Год пишется, если он не совпадает с годом даты оплаты: «Зарплата за декабрь 2025».
 */
export function salaryRowText(categoryName: string, accrualDate: string | null, paidDate: string): { text: string; muted: boolean } {
  const source = accrualDate ?? paidDate;
  const month = Number(source.slice(5, 7));
  const year = source.slice(0, 4) === paidDate.slice(0, 4) ? '' : ` ${source.slice(0, 4)}`;
  return { text: `${categoryName} за ${MONTHS_LOWER[month - 1]}${year}`, muted: accrualDate === null };
}

/** Первое число месяца `YYYY-MM-01` — дата сделки при выборе месяца зарплаты (решение владельца 14.3 №4). */
export function firstOfMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}
