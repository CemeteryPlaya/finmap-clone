import { describe, expect, it } from 'vitest';
import type { JournalLookups } from '../../src/client/components/journal/JournalTable';
import { journalCardText, type JournalCardText } from '../../src/client/lib/journal-card';
import type { Account, JournalItem, OperationLine } from '../../src/client/lib/queries';

const TZ = 'Asia/Almaty';
const ctx = { baseCurrency: 'KZT', timeZone: TZ };

const account = (id: number, name: string, currency: string): Account => ({
  id,
  companyId: 1,
  projectId: null,
  name,
  currency,
  startingBalance: 0,
  openedAt: '2020-01-01',
  orderIndex: id,
  createdAt: '2020-01-01T00:00:00.000Z',
  archivedAt: null,
  hasOperations: true,
});

const lookups: JournalLookups = {
  accounts: new Map([
    [1, account(1, 'Касса', 'KZT')],
    [2, account(2, 'Валютный', 'USD')],
  ]),
  categories: new Map([
    [10, { name: 'Аренда', systemKey: null }],
    [11, { name: 'Зарплата → Администраторы', systemKey: null }],
  ]),
  projects: new Map([[20, 'Клуб Север']]),
  counterparties: new Map([[30, 'ТОО Ромашка']]),
};

const line = (categoryId: number | null, projectId: number | null, amount: number, position = 0): OperationLine => ({
  id: position + 1,
  position,
  categoryId,
  projectId,
  amount,
  baseAmount: amount,
});

const item = (patch: Partial<JournalItem>): JournalItem => ({
  id: 1,
  companyId: 1,
  type: 'expense',
  status: 'actual',
  paidAt: '2026-10-07T05:30:00.000Z', // 10:30 по Алматы
  accrualDate: null,
  accountId: 1,
  amount: 250000,
  toAccountId: null,
  toAmount: null,
  rate: '1',
  baseAmount: 250000,
  counterpartyId: null,
  comment: null,
  createdBy: 1,
  createdAt: '2026-10-07T05:30:00.000Z',
  updatedAt: '2026-10-07T05:30:00.000Z',
  version: 1,
  deletedAt: null,
  lines: [line(10, null, 250000)],
  tagIds: [],
  attachmentCount: 0,
  balanceAfter: null,
  toBalanceAfter: null,
  ...patch,
});

/** Неразрывные пробелы денег (U+00A0, U+202F) → обычные: так ожидания читаются. */
const plain = (card: JournalCardText) =>
  Object.fromEntries(Object.entries(card).map(([k, v]) => [k, v === null ? null : v.replace(/[\u00A0\u202F]/g, ' ')]));

describe('карточка операции в журнале на телефоне (§8.4 этапа 1.5)', () => {
  it('расход: дата без времени, сумма со знаком, контрагент, счёт, категория; комментария нет', () => {
    expect(plain(journalCardText(item({ counterpartyId: 30, comment: 'за октябрь' }), lookups, ctx))).toEqual({
      date: '7 окт. 2026',
      amount: '\u22122 500 ₸',
      extra: null,
      counterparty: 'ТОО Ромашка',
      account: 'Касса',
      category: 'Аренда',
    });
  });

  it('разбитый доход — «2 категории»; без категории — «Без категории»; без контрагента — строки нет', () => {
    const split = item({ type: 'income', paidAt: '2026-10-06T03:00:00.000Z', lines: [line(10, 20, 100000), line(11, 20, 150000, 1)] });
    expect(plain(journalCardText(split, lookups, ctx))).toMatchObject({ date: '6 окт. 2026', amount: '+2 500 ₸', counterparty: null, category: '2 категории' });
    const none = item({ paidAt: '2026-10-01T13:15:00.000Z', lines: [line(null, 20, 250000)] });
    expect(journalCardText(none, lookups, ctx)).toMatchObject({ date: '1 окт. 2026', category: 'Без категории' });
  });

  it('разбитый расход: «2 категории», сумма — общая со знаком минус', () => {
    const split = item({ amount: 250000, lines: [line(10, null, 100000), line(11, null, 150000, 1)] });
    expect(plain(journalCardText(split, lookups, ctx))).toMatchObject({ amount: '\u22122 500 ₸', category: '2 категории', extra: null });
  });

  it('счёт в архиве: имя счёта остаётся в карточке', () => {
    const archived: JournalLookups = { ...lookups, accounts: new Map([[1, { ...account(1, 'Старая касса', 'KZT'), archivedAt: '2026-01-01T00:00:00.000Z' }]]) };
    expect(journalCardText(item({}), archived, ctx).account).toBe('Старая касса');
  });

  it('копейки: сумма с дробной частью выводится с запятой', () => {
    expect(plain(journalCardText(item({ amount: 250050, baseAmount: 250050, lines: [line(10, null, 250050)] }), lookups, ctx)).amount).toBe('\u22122 500,50 ₸');
  });

  it('дата — по поясу приложения: 19:30 UTC 6 октября — уже 7 октября в Алматы', () => {
    expect(journalCardText(item({ paidAt: '2026-10-06T19:30:00.000Z' }), lookups, ctx).date).toBe('7 окт. 2026');
  });

  it('перевод между валютами: оба счёта, сумма без знака, зачисление в валюте получателя; строки категории нет', () => {
    const transfer = item({ type: 'transfer', accountId: 1, toAccountId: 2, amount: 50000, toAmount: 100, lines: [] });
    expect(plain(journalCardText(transfer, lookups, ctx))).toMatchObject({
      account: 'Касса → Валютный',
      amount: '500 ₸',
      extra: '→ 1 $',
      counterparty: null,
      category: null,
    });
  });

  it('счёт не в базовой валюте — под суммой сумма в базовой; неизвестные справочники — «…»', () => {
    const usd = item({ accountId: 2, amount: 100, baseAmount: 50000, counterpartyId: 99, lines: [line(77, null, 100)] });
    expect(plain(journalCardText(usd, lookups, ctx))).toMatchObject({ category: '…', account: 'Валютный', amount: '\u22121 $', extra: '500 ₸', counterparty: '…' });
    expect(journalCardText(item({ accountId: 5 }), lookups, ctx).account).toBe('…');
  });
});

describe('карточка «Выписки по счету» (§6 спецификации «Аналитика»)', () => {
  const transfer = item({ type: 'transfer', accountId: 1, toAccountId: 2, amount: 47512, toAmount: 100, balanceAfter: 1522488, toBalanceAfter: 100, lines: [] });

  it('перевод между валютами глазами каждого счёта: знак и валюта счёта, остаток после операции, «Перевод: {другой счёт}»', () => {
    expect(plain(journalCardText(transfer, lookups, { ...ctx, statementAccountId: 1 }))).toEqual({
      date: '7 окт. 2026',
      amount: '\u2212475,12 ₸',
      extra: null,
      counterparty: null,
      account: 'Остаток: 15 224,88 ₸',
      category: 'Перевод: Валютный',
    });
    expect(plain(journalCardText(transfer, lookups, { ...ctx, statementAccountId: 2 }))).toMatchObject({ amount: '+1 $', account: 'Остаток: 1 $', category: 'Перевод: Касса' });
  });

  it('доход и расход — знак по движению, категория как в журнале; остатка нет — имя счёта', () => {
    const income = item({ type: 'income', amount: 100000, balanceAfter: -50000, lines: [line(10, null, 100000)] });
    expect(plain(journalCardText(income, lookups, { ...ctx, statementAccountId: 1 }))).toMatchObject({ amount: '+1 000 ₸', account: 'Остаток: \u2212500 ₸', category: 'Аренда' });
    expect(plain(journalCardText(item({}), lookups, { ...ctx, statementAccountId: 1 }))).toMatchObject({ amount: '\u22122 500 ₸', account: 'Касса', category: 'Аренда' });
  });
});
