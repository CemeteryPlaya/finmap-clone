import { describe, expect, it } from 'vitest';
import type { JournalLookups } from '../../src/client/components/journal/JournalTable';
import { journalCardText, type JournalCardText } from '../../src/client/lib/journal-card';
import type { Account, JournalItem, OperationLine } from '../../src/client/lib/queries';

const TZ = 'Asia/Almaty';
const ctx = { baseCurrency: 'KZT', timeZone: TZ, today: '2026-10-07' };

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
    [10, 'Аренда'],
    [11, 'Зарплата → Администраторы'],
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

describe('карточка операции в журнале на телефоне', () => {
  it('расход: категория, счёт, контрагент и комментарий, сумма со знаком, «сегодня» и время', () => {
    expect(plain(journalCardText(item({ counterpartyId: 30, comment: 'за октябрь' }), lookups, ctx))).toEqual({
      title: 'Аренда',
      account: 'Касса',
      details: 'ТОО Ромашка · за октябрь',
      amount: '\u22122 500 ₸',
      extra: null,
      date: 'сегодня 10:30',
    });
  });

  it('разбитый доход — «2 категории»; без категории — «Без категории»; вчера и раньше — по дате', () => {
    const split = item({
      type: 'income',
      paidAt: '2026-10-06T03:00:00.000Z',
      lines: [line(10, 20, 100000), line(11, 20, 150000, 1)],
    });
    expect(plain(journalCardText(split, lookups, ctx))).toMatchObject({ title: '2 категории', amount: '+2 500 ₸', date: 'вчера 08:00', details: null });
    const none = item({ paidAt: '2026-10-01T13:15:00.000Z', lines: [line(null, 20, 250000)] });
    expect(journalCardText(none, lookups, ctx)).toMatchObject({ title: 'Без категории', date: '01.10.2026 18:15' });
  });

  it('перевод между валютами: оба счёта, сумма без знака и зачисление в валюте счёта получателя', () => {
    const transfer = item({ type: 'transfer', accountId: 1, toAccountId: 2, amount: 50000, toAmount: 100, lines: [] });
    expect(plain(journalCardText(transfer, lookups, ctx))).toMatchObject({
      title: 'Перевод',
      account: 'Касса → Валютный',
      amount: '500 ₸',
      extra: '→ 1 $',
    });
  });

  it('счёт не в базовой валюте — вторая строка в базовой; неизвестные справочники — «…»', () => {
    const usd = item({ accountId: 2, amount: 100, baseAmount: 50000, counterpartyId: 99, lines: [line(77, null, 100)] });
    expect(plain(journalCardText(usd, lookups, ctx))).toMatchObject({ title: '…', account: 'Валютный', amount: '\u22121 $', extra: '500 ₸', details: '…' });
    expect(journalCardText(item({ accountId: 5 }), lookups, ctx).account).toBe('…');
  });
});
