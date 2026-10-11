import { describe, expect, it } from 'vitest';
import { archivedAccountOf, draftFromOperation, duplicateDraft, patchBody, withoutArchived, type OperationRecord } from '../../src/client/lib/operation-edit';
import { buildBody, type DraftContext, type OperationDraft } from '../../src/client/lib/operation-form';

const TZ = 'Asia/Almaty';
const NOW = new Date('2026-10-07T05:30:00.000Z'); // 10:30 по Алматы
const ARCH = '2026-10-01T00:00:00.000Z';
const accounts = new Map([
  [1, { id: 1, name: 'Касса', currency: 'KZT', archivedAt: null }],
  [2, { id: 2, name: 'Kaspi', currency: 'KZT', archivedAt: null }],
  [3, { id: 3, name: 'Доллары', currency: 'USD', archivedAt: null }],
  [4, { id: 4, name: 'Старый', currency: 'KZT', archivedAt: ARCH }],
]);

const op = (patch: Partial<OperationRecord> = {}): OperationRecord => ({
  id: 9,
  type: 'expense',
  paidAt: '2026-10-05T13:15:00.000Z', // 05.10, 18:15 по Алматы
  accrualDate: null,
  accountId: 1,
  amount: 150050,
  toAccountId: null,
  toAmount: null,
  counterpartyId: 5,
  comment: 'аренда',
  version: 3,
  deletedAt: null,
  lines: [{ categoryId: 7, projectId: 8, amount: 150050 }],
  tagIds: [2, 1],
  ...patch,
});

/** Правка в форме → тело PATCH: как это делает форма (время суток — прежнее). */
const patchFor = (o: OperationRecord, edit: (d: OperationDraft) => OperationDraft) => {
  const ctx: DraftContext = { accounts, today: '2026-10-07', timeZone: TZ, now: NOW, timeOfDayFrom: new Date(o.paidAt), originalPaidAt: o.paidAt };
  const r = buildBody(edit(draftFromOperation(o, accounts, TZ)), ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return patchBody(o, r.body, TZ);
};

describe('draftFromOperation', () => {
  it('доход или расход с одной строкой: суммы текстом с запятой, дата оплаты по Алматы, без разбиения', () => {
    expect(draftFromOperation(op({ accrualDate: '2026-09-30' }), accounts, TZ)).toMatchObject({
      type: 'expense',
      accountId: 1,
      amount: '1500,5',
      paidDate: '2026-10-05',
      accrualOn: true,
      accrualDate: '2026-09-30',
      categoryId: 7,
      projectId: 8,
      counterpartyId: 5,
      tagIds: [2, 1],
      comment: 'аренда',
      split: null,
    });
  });

  it('несколько строк — разбиение в суммах; перевод между валютами — сумма зачисления и проект строки', () => {
    const d = draftFromOperation(
      op({ amount: 1000, lines: [{ categoryId: 7, projectId: 8, amount: 600 }, { categoryId: 7, projectId: null, amount: 400 }] }),
      accounts,
      TZ,
    );
    expect(d.categoryId).toBeNull();
    expect(d.split).toMatchObject({ mode: 'amount', lines: [{ categoryId: 7, projectId: 8, value: '6' }, { categoryId: 7, projectId: null, value: '4' }] });
    const t = draftFromOperation(op({ type: 'transfer', toAccountId: 3, toAmount: 1000, counterpartyId: null, lines: [{ categoryId: null, projectId: 8, amount: 150050 }] }), accounts, TZ);
    expect(t).toMatchObject({ toAccountId: 3, toAmount: '10', projectId: 8, split: null });
    expect(draftFromOperation(op({ type: 'transfer', toAccountId: 2, toAmount: 150050, lines: [] }), accounts, TZ).toAmount).toBe('');
  });

  it('время операции — в поле (ЧЧ:ММ по Алматы), но не «задано руками»', () => {
    expect(draftFromOperation(op(), accounts, TZ)).toMatchObject({ paidDate: '2026-10-05', paidTime: '18:15', paidTimeSet: false });
  });
});

describe('patchBody — в PATCH только изменённые поля (итоги 4a, п. 1)', () => {
  it('ничего не изменено — запроса нет', () => {
    expect(patchFor(op(), (d) => d)).toBeNull();
    expect(patchFor(op({ type: 'transfer', toAccountId: 3, toAmount: 1000, counterpartyId: null, comment: null, lines: [] }), (d) => d)).toBeNull();
  });

  it('комментарий — только он и версия', () => {
    expect(patchFor(op(), (d) => ({ ...d, comment: 'новый' }))).toEqual({ version: 3, comment: 'новый' });
  });

  it('сумма: строка следует за суммой; другой день — та же минута суток', () => {
    expect(patchFor(op(), (d) => ({ ...d, amount: '2000', paidDate: '2026-10-04' }))).toEqual({
      version: 3,
      amount: 200000,
      paidAt: '2026-10-04T13:15:00.000Z',
      lines: [{ categoryId: 7, projectId: 8, amount: 200000 }],
    });
  });

  it('теги — без учёта порядка; новая категория — новые строки', () => {
    expect(patchFor(op(), (d) => ({ ...d, tagIds: [1, 2] }))).toBeNull();
    expect(patchFor(op(), (d) => ({ ...d, categoryId: 70 }))).toEqual({ version: 3, lines: [{ categoryId: 70, projectId: 8, amount: 150050 }] });
  });

  it('перевод в одной валюте: новая сумма без суммы зачисления и без null в полях перевода (иначе INVARIANT_4 или 400)', () => {
    const t = op({ type: 'transfer', toAccountId: 2, toAmount: 150050, counterpartyId: null, comment: null, lines: [] });
    expect(patchFor(t, (d) => ({ ...d, amount: '100' }))).toEqual({ version: 3, amount: 10000 });
  });

  it('перевод между валютами: меняется только сумма зачисления', () => {
    const t = op({ type: 'transfer', toAccountId: 3, toAmount: 1000, counterpartyId: null, comment: null, lines: [] });
    expect(patchFor(t, (d) => ({ ...d, toAmount: '11' }))).toEqual({ version: 3, toAmount: 1100 });
  });

  it('перевод KZT → USD: новая сумма списания — вместе с суммой зачисления (иначе сервер её сбросит и ответит 400)', () => {
    const t = op({ type: 'transfer', amount: 5000000, toAccountId: 3, toAmount: 10000, counterpartyId: null, comment: null, lines: [] });
    expect(patchFor(t, (d) => ({ ...d, amount: '500' }))).toEqual({ version: 3, amount: 50000, toAmount: 10000 });
    expect(patchFor(t, (d) => ({ ...d, accountId: 2 }))).toEqual({ version: 3, accountId: 2, toAmount: 10000 });
  });

  it('время (§2.3 этапа 1.5): без смены даты и времени — без paidAt, секунды сохраняются; та же минута руками — тоже; другое время — ЧЧ:ММ:00 (Review Focus 1)', () => {
    const o = op({ paidAt: '2026-10-05T13:15:42.250Z' }); // 05.10, 18:15:42 по Алматы
    expect(patchFor(o, (d) => ({ ...d, comment: 'новый' }))).toEqual({ version: 3, comment: 'новый' });
    expect(patchFor(o, (d) => ({ ...d, paidTime: '18:15', paidTimeSet: true }))).toBeNull();
    expect(patchFor(o, (d) => ({ ...d, paidTime: '09:05', paidTimeSet: true }))).toEqual({ version: 3, paidAt: '2026-10-05T04:05:00.000Z' });
    // смена даты без времени — прежнее время суток с секундами
    expect(patchFor(o, (d) => ({ ...d, paidDate: '2026-10-04' }))).toEqual({ version: 3, paidAt: '2026-10-04T13:15:42.250Z' });
    // смена даты и времени
    expect(patchFor(o, (d) => ({ ...d, paidDate: '2026-10-04', paidTime: '23:00', paidTimeSet: true }))).toEqual({ version: 3, paidAt: '2026-10-04T18:00:00.000Z' });
  });

  it('сохранённое время сегодня позже «сейчас» этого устройства: правка комментария не трогает paidAt (Review Focus 1)', () => {
    const o = op({ paidAt: '2026-10-07T10:00:00.250Z' }); // 15:00 по Алматы, NOW — 10:30
    expect(patchFor(o, (d) => ({ ...d, comment: 'новый' }))).toEqual({ version: 3, comment: 'новый' });
  });
});

describe('duplicateDraft, archivedAccountOf', () => {
  it('копия — на сегодня, без архивных ссылок', () => {
    const d = draftFromOperation(op({ accountId: 4, tagIds: [1, 2], counterpartyId: 5 }), accounts, TZ);
    const available = { accounts: new Set([1, 2, 3]), categories: new Set([7]), projects: new Set<number>(), counterparties: new Set<number>(), tags: new Set([1]) };
    expect(duplicateDraft(d, available, '2026-10-07')).toMatchObject({
      paidDate: '2026-10-07',
      accountId: null,
      categoryId: 7,
      projectId: null,
      counterpartyId: null,
      tagIds: [1],
      amount: '1500,5',
      comment: 'аренда',
    });
    // «Дублировать»: дата «сегодня», время «живое»
    expect(duplicateDraft({ ...d, paidTime: '18:15', paidTimeSet: true }, available, '2026-10-07')).toMatchObject({ paidDate: '2026-10-07', paidTime: '', paidTimeSet: false });
  });

  it('без архивных ссылок — для «Сохранить и создать похожий» после правки; дата остаётся', () => {
    const d = draftFromOperation(op({ accountId: 4 }), accounts, TZ);
    const available = { accounts: new Set([1]), categories: new Set<number>(), projects: new Set([8]), counterparties: new Set([5]), tags: new Set([1, 2]) };
    expect(withoutArchived(d, available)).toMatchObject({ accountId: null, categoryId: null, projectId: 8, counterpartyId: 5, paidDate: '2026-10-05' });
  });

  it('архивный счёт операции — любой из двух у перевода', () => {
    expect(archivedAccountOf(op(), accounts)).toBeNull();
    expect(archivedAccountOf(op({ accountId: 4 }), accounts)?.name).toBe('Старый');
    expect(archivedAccountOf(op({ type: 'transfer', toAccountId: 4 }), accounts)?.name).toBe('Старый');
  });
});
