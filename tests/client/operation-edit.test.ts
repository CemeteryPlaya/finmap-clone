import { describe, expect, it } from 'vitest';
import {
  archivedAccountOf,
  convertBlockedHint,
  convertQuestion,
  convertToTransferDraft,
  draftFromOperation,
  duplicateDraft,
  patchBody,
  pickConvertedFrom,
  withoutArchived,
  type ConvertNames,
  type OperationRecord,
} from '../../src/client/lib/operation-edit';
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
      stockPayments: [],
    });
  });

  it('оплаты закупок расхода — в черновик текстом сумм; в PATCH уходят, только если изменились', () => {
    const paid = op({ stockPayments: [{ docId: 4, number: 'П-0001', amount: 60000 }, { docId: 5, number: 'П-0002', amount: 40050 }] });
    expect(draftFromOperation(paid, accounts, TZ).stockPayments).toEqual([{ docId: 4, amount: '600' }, { docId: 5, amount: '400,5' }]);
    expect(patchFor(paid, (d) => d)).toBeNull();
    expect(patchFor(paid, (d) => ({ ...d, comment: 'новый' }))).toEqual({ version: 3, comment: 'новый' });
    expect(patchFor(paid, (d) => ({ ...d, stockPayments: [{ docId: 4, amount: '700' }] }))).toEqual({ version: 3, stockPayments: [{ docId: 4, amount: 70000 }] });
    expect(patchFor(paid, (d) => ({ ...d, stockPayments: [] }))).toEqual({ version: 3, stockPayments: [] });
    expect(patchFor(op(), (d) => ({ ...d, stockPayments: [{ docId: 4, amount: '100' }] }))).toEqual({ version: 3, stockPayments: [{ docId: 4, amount: 10000 }] });
  });

  it('«Дублировать» и «Изменить в перевод» оплаты закупки не переносят; перевод предупреждает, что оплата будет убрана', () => {
    const d = { ...draftFromOperation(op(), accounts, TZ), stockPayments: [{ docId: 4, amount: '600' }] };
    expect(duplicateDraft(d, { accounts: new Set([1]), categories: new Set([7]), projects: new Set([8]), counterparties: new Set([5]), tags: new Set([1, 2]) }, '2026-10-07').stockPayments).toEqual([]);
    const r = convertToTransferDraft(d, { category: () => 'Закупки', counterparty: () => 'Поставщик А' });
    expect(r.losses).toEqual(['категория «Закупки»', 'контрагент «Поставщик А»', 'оплата закупки']);
    expect(r.draft.stockPayments).toEqual([]);
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
    expect(draftFromOperation(op(), accounts, TZ)).toMatchObject({ paidDate: '2026-10-05', paidTime: '18:15', paidTimeSet: false, paidDateSet: true });
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
    expect(duplicateDraft({ ...d, paidTime: '18:15', paidTimeSet: true }, available, '2026-10-07')).toMatchObject({ paidDate: '2026-10-07', paidDateSet: false, paidTime: '', paidTimeSet: false });
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

const names: ConvertNames = {
  category: (id) => (id === 7 ? 'Зарплата' : id === 6 ? 'Бар' : undefined),
  counterparty: (id) => (id === 5 ? 'Алина' : undefined),
};
/** Доход на долларовом счёте 3 без категории и контрагента: $100. */
const usdIncome = () => op({ type: 'income', accountId: 3, amount: 10000, counterpartyId: null, lines: [{ categoryId: null, projectId: null, amount: 10000 }] });

describe('«Изменить в перевод» (§6.8, §10.1 этапа 1.5)', () => {
  it('расход: «Со счёта» — прежний счёт, «На счёт» пусто; убраны категория, контрагент, дата сделки; проект, теги, комментарий, дата и время остаются', () => {
    const d = draftFromOperation(op({ accrualDate: '2026-09-30' }), accounts, TZ);
    const r = convertToTransferDraft(d, names);
    expect(r.losses).toEqual(['категория «Зарплата»', 'контрагент «Алина»', 'дата сделки']);
    expect(convertQuestion(r.losses)).toBe('Будут убраны: категория «Зарплата», контрагент «Алина», дата сделки.');
    expect(r.carried).toBeNull();
    expect(r.draft).toEqual({ ...d, type: 'transfer', accountId: 1, toAccountId: null, toAmount: '', categoryId: null, projectId: 8, counterpartyId: null, accrualOn: false, split: null, stockPayments: [] });
  });

  it('доход: прежний счёт — «На счёт», «Со счёта» пусто; прежняя сумма — и сумма, и «Сумма зачисления»; терять нечего — список пуст', () => {
    const r = convertToTransferDraft(draftFromOperation(usdIncome(), accounts, TZ), names);
    expect(r.losses).toEqual([]);
    expect(r.carried).toBe('100');
    expect(r.draft).toMatchObject({ type: 'transfer', accountId: null, toAccountId: 3, amount: '100', toAmount: '100', projectId: null, tagIds: [2, 1], comment: 'аренда', paidDate: '2026-10-05', paidTime: '18:15' });
  });

  it('разбиение: «разбиение на 2 строки» вместо категорий; проект остаётся, только если он один у всех строк (Review Focus 2)', () => {
    const lines = [
      { categoryId: 7, projectId: 8, amount: 100000 },
      { categoryId: 6, projectId: 8, amount: 50050 },
    ];
    const same = convertToTransferDraft(draftFromOperation(op({ lines }), accounts, TZ), names);
    expect(same.losses).toEqual(['контрагент «Алина»', 'разбиение на 2 строки']);
    expect(same.draft).toMatchObject({ projectId: 8, categoryId: null, split: null });
    const mixed = convertToTransferDraft(draftFromOperation(op({ counterpartyId: null, lines: [lines[0]!, { ...lines[1]!, projectId: null }] }), accounts, TZ), names);
    expect(mixed.losses).toEqual(['разбиение на 2 строки']);
    expect(mixed.draft.projectId).toBeNull();
    // название не найдено — только слово; уже перевод — без изменений
    expect(convertToTransferDraft(draftFromOperation(op({ counterpartyId: 99, lines: [{ categoryId: 98, projectId: null, amount: 150050 }] }), accounts, TZ), names).losses).toEqual(['категория', 'контрагент']);
    const t = draftFromOperation(op({ type: 'transfer', toAccountId: 2, toAmount: 150050, counterpartyId: null, lines: [] }), accounts, TZ);
    expect(convertToTransferDraft(t, names)).toEqual({ draft: t, losses: [], carried: null });
  });

  it('доход: «Со счёта» в другой валюте очищает сумму списания, в той же — возвращает прежнюю; набранную руками не трогает (Review Focus 1)', () => {
    const usd = convertToTransferDraft(draftFromOperation(usdIncome(), accounts, TZ), names);
    expect(pickConvertedFrom(usd.draft, 1, accounts, usd.carried!)).toMatchObject({ accountId: 1, amount: '', toAmount: '100' });

    const kzt = convertToTransferDraft(draftFromOperation(op({ type: 'income', counterpartyId: null }), accounts, TZ), names);
    expect(kzt.draft).toMatchObject({ accountId: null, toAccountId: 1, amount: '1500,5', toAmount: '1500,5' });
    expect(pickConvertedFrom(kzt.draft, 2, accounts, kzt.carried!)).toMatchObject({ accountId: 2, amount: '1500,5' });
    const toUsd = pickConvertedFrom(kzt.draft, 3, accounts, kzt.carried!);
    expect(toUsd).toMatchObject({ accountId: 3, amount: '', toAmount: '1500,5' });
    expect(pickConvertedFrom(toUsd, 2, accounts, kzt.carried!).amount).toBe('1500,5');
    expect(pickConvertedFrom({ ...toUsd, amount: '3' }, 2, accounts, kzt.carried!).amount).toBe('3');
    expect(pickConvertedFrom({ ...kzt.draft, amount: '3' }, 3, accounts, kzt.carried!).amount).toBe('3');
  });

  it('строка недоступна: счёт операции в архиве; нет другого активного счёта (Review Focus 3)', () => {
    const list = [...accounts.values()];
    expect(convertBlockedHint(null, list, 1)).toBeUndefined();
    expect(convertBlockedHint({ name: 'Старый' }, list, 4)).toBe('Изменить в перевод нельзя: счёт в архиве («Старый»)');
    expect(convertBlockedHint(null, list.filter((a) => a.id === 1 || a.id === 4), 1)).toBe('Изменить в перевод нельзя: нет другого счёта');
  });

  it('PATCH расхода: type, счёт зачисления и явные поля — контрагент null, строка без категории с проектом; дата сделки null, если была', () => {
    const toKaspi = (d: OperationDraft) => ({ ...convertToTransferDraft(d, names).draft, toAccountId: 2 });
    expect(patchFor(op(), toKaspi)).toEqual({ version: 3, type: 'transfer', toAccountId: 2, counterpartyId: null, lines: [{ categoryId: null, projectId: 8, amount: 150050 }] });
    expect(patchFor(op({ accrualDate: '2026-09-30' }), toKaspi)).toMatchObject({ type: 'transfer', accrualDate: null });
  });

  it('PATCH дохода между валютами: счёт и сумма списания, прежний счёт и сумма — зачисление, строк нет (Review Focus 1)', () => {
    const income = op({ type: 'income', accountId: 3, amount: 10000, counterpartyId: null, lines: [{ categoryId: 7, projectId: null, amount: 10000 }] });
    const body = patchFor(income, (d) => {
      const r = convertToTransferDraft(d, names);
      return { ...pickConvertedFrom(r.draft, 1, accounts, r.carried!), amount: '47512' };
    });
    expect(body).toEqual({ version: 3, type: 'transfer', accountId: 1, amount: 4751200, toAccountId: 3, toAmount: 10000, lines: [] });
  });
});

describe('«Изменить в перевод»: дополнения итогового обзора', () => {
  const fiveLines = Array.from({ length: 5 }, (_, i) => ({ categoryId: 7, projectId: 8, amount: 10000 + i }));
  const toKaspi = (d: OperationDraft) => ({ ...convertToTransferDraft(d, names).draft, toAccountId: 2 });

  it('разбиение на 5 строк — склонение «5 строк»', () => {
    const r = convertToTransferDraft(draftFromOperation(op({ counterpartyId: null, lines: fiveLines }), accounts, TZ), names);
    expect(r.losses).toEqual(['разбиение на 5 строк']);
  });

  it('PATCH перевода в перевод не содержит type', () => {
    const transfer = op({ type: 'transfer', toAccountId: 2, toAmount: 150050, counterpartyId: null, lines: [] });
    const body = patchFor(transfer, (d) => ({ ...d, comment: 'новый' }));
    expect(body).toEqual({ version: 3, comment: 'новый' });
    expect('type' in body!).toBe(false);
  });

  it('convertBlockedHint без счёта у черновика: есть активный счёт — доступна', () => {
    expect(convertBlockedHint(null, [...accounts.values()], null)).toBeUndefined();
  });

  it('PATCH разбитой операции: один проект у всех строк — строка без категории с проектом; разные — строк нет', () => {
    const lines = [
      { categoryId: 7, projectId: 8, amount: 100000 },
      { categoryId: 6, projectId: 8, amount: 50050 },
    ];
    expect(patchFor(op({ lines }), toKaspi)).toEqual({ version: 3, type: 'transfer', toAccountId: 2, counterpartyId: null, lines: [{ categoryId: null, projectId: 8, amount: 150050 }] });
    const mixed = op({ lines: [lines[0]!, { ...lines[1]!, projectId: null }] });
    expect(patchFor(mixed, toKaspi)).toEqual({ version: 3, type: 'transfer', toAccountId: 2, counterpartyId: null, lines: [] });
  });
});
