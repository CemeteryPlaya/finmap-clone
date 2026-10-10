import { describe, expect, it } from 'vitest';
import {
  buildBody,
  changeType,
  emptyDraft,
  paidAtFor,
  similarDraft,
  transferRateText,
  type DraftContext,
  type OperationDraft,
} from '../../src/client/lib/operation-form';
import { newLine } from '../../src/client/lib/split';

const TZ = 'Asia/Almaty';
// 07.10.2026, 10:30:00.123 по Алматы (UTC+5)
const NOW = new Date('2026-10-07T05:30:00.123Z');

const ctx: DraftContext = {
  accounts: new Map([
    [1, { id: 1, currency: 'KZT' }],
    [2, { id: 2, currency: 'KZT' }],
    [3, { id: 3, currency: 'USD' }],
    [4, { id: 4, currency: 'JPY' }],
  ]),
  today: '2026-10-07',
  timeZone: TZ,
  now: NOW,
  timeOfDayFrom: NOW,
};

const draft = (patch: Partial<OperationDraft>): OperationDraft => ({ ...emptyDraft('expense', '2026-10-07', 1), ...patch });
const body = (d: OperationDraft) => {
  const r = buildBody(d, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.body;
};
const errors = (d: OperationDraft) => {
  const r = buildBody(d, ctx);
  if (r.ok) throw new Error('ожидались ошибки');
  return r.errors;
};

describe('paidAtFor — момент оплаты из даты формы', () => {
  it('сегодня — «сейчас»; прошлый день — то же время суток по Алматы', () => {
    expect(paidAtFor('2026-10-07', NOW, NOW, TZ)).toBe('2026-10-07T05:30:00.123Z');
    expect(paidAtFor('2026-10-05', NOW, NOW, TZ)).toBe('2026-10-05T05:30:00.123Z');
  });

  it('прежнее время операции переносится на новую дату, но не позже «сейчас»', () => {
    const lateEvening = new Date('2026-10-05T18:30:00.000Z'); // 23:30 по Алматы
    expect(paidAtFor('2026-10-06', lateEvening, NOW, TZ)).toBe('2026-10-06T18:30:00.000Z');
    expect(paidAtFor('2026-10-07', lateEvening, NOW, TZ)).toBe(NOW.toISOString());
  });

  it('до 01.03.2024 в Алматы было UTC+6 — граница суток по дате операции', () => {
    expect(paidAtFor('2024-01-15', NOW, NOW, TZ)).toBe('2024-01-15T04:30:00.123Z');
  });
});

describe('buildBody — черновик формы → тело POST /operations', () => {
  it('расход: выражение в сумме, одна строка с категорией и проектом, комментарий без краевых пробелов', () => {
    expect(
      body(draft({ amount: '1 000 + 500,5', categoryId: 7, projectId: 8, counterpartyId: 9, tagIds: [3, 2], comment: '  аренда  ' })),
    ).toEqual({
      type: 'expense',
      paidAt: '2026-10-07T05:30:00.123Z',
      accrualDate: null,
      accountId: 1,
      amount: 150050,
      toAccountId: null,
      toAmount: null,
      counterpartyId: 9,
      comment: 'аренда',
      lines: [{ categoryId: 7, projectId: 8, amount: 150050 }],
      tagIds: [3, 2],
    });
  });

  it('доход без категории — строка на всю сумму; дата сделки — только при включённом переключателе', () => {
    const b = body(draft({ type: 'income', amount: '100', accrualOn: true, accrualDate: '2026-09-30', comment: '   ' }));
    expect(b).toMatchObject({ type: 'income', accrualDate: '2026-09-30', comment: null, lines: [{ categoryId: null, projectId: null, amount: 10000 }] });
    expect(body(draft({ amount: '100', accrualOn: false, accrualDate: '2026-09-30' })).accrualDate).toBeNull();
  });

  it('сумма округляется до минимальных единиц валюты счёта (JPY — без дробной части)', () => {
    expect(body(draft({ accountId: 4, amount: '10/4' })).amount).toBe(3);
    expect(body(draft({ amount: '10/3' })).amount).toBe(333);
  });

  it('перевод в одной валюте: сумма зачисления не передаётся, строк нет; с проектом — одна строка без категории', () => {
    const t = draft({ type: 'transfer', accountId: 1, toAccountId: 2, amount: '500', toAmount: '999', counterpartyId: 9, categoryId: 7 });
    expect(body(t)).toMatchObject({ type: 'transfer', toAccountId: 2, toAmount: null, counterpartyId: null, lines: [] });
    expect(body({ ...t, projectId: 8 }).lines).toEqual([{ categoryId: null, projectId: 8, amount: 50000 }]);
    // у перевода нет даты сделки — включённый раньше у расхода переключатель не действует
    expect(body({ ...t, accrualOn: true, accrualDate: '2026-09-30' }).accrualDate).toBeNull();
  });

  it('перевод KZT → USD: «Сумма зачисления» в валюте счёта зачисления', () => {
    expect(body(draft({ type: 'transfer', accountId: 1, toAccountId: 3, amount: '50 000', toAmount: '100' }))).toMatchObject({
      amount: 5000000,
      toAccountId: 3,
      toAmount: 10000,
    });
  });

  it('ошибки по полям: счёт, сумма, счёт зачисления, сумма зачисления, будущая дата, дата сделки, длинный комментарий', () => {
    expect(errors(draft({ accountId: null, amount: '' }))).toEqual({ accountId: 'Выберите счёт' });
    expect(errors(draft({ amount: '' }))).toEqual({ amount: 'Введите сумму' });
    expect(errors(draft({ amount: '0' }))).toEqual({ amount: 'Сумма больше нуля' });
    expect(errors(draft({ amount: '5-10' }))).toEqual({ amount: 'Сумма больше нуля' });
    expect(errors(draft({ amount: '5/0' }))).toEqual({ amount: 'Деление на ноль' });
    expect(errors(draft({ type: 'transfer', amount: '1' }))).toEqual({ toAccountId: 'Выберите счёт зачисления' });
    expect(errors(draft({ type: 'transfer', amount: '1', toAccountId: 1 }))).toEqual({ toAccountId: 'Выберите другой счёт' });
    expect(errors(draft({ type: 'transfer', amount: '1', toAccountId: 3 }))).toEqual({ toAmount: 'Укажите сумму зачисления' });
    expect(errors(draft({ type: 'transfer', amount: '1', toAccountId: 3, toAmount: '0' }))).toEqual({ toAmount: 'Сумма больше нуля' });
    expect(errors(draft({ amount: '1', paidDate: '2026-10-08' }))).toEqual({ paidAt: 'Дата оплаты в будущем — так нельзя' });
    expect(errors(draft({ amount: '1', paidDate: '' }))).toEqual({ paidAt: 'Укажите дату оплаты' });
    expect(errors(draft({ amount: '1', accrualOn: true, accrualDate: '2026-02-30' }))).toEqual({ accrualDate: 'Укажите дату сделки' });
    expect(errors(draft({ amount: '1', comment: 'я'.repeat(2001) }))).toEqual({ comment: 'Не длиннее 2000 символов' });
  });
});

describe('buildBody — разбиение', () => {
  const split = (mode: 'amount' | 'percent', ...values: string[]) => ({
    mode,
    lines: values.map((value, i) => newLine({ categoryId: 7 + i, projectId: i === 0 ? 8 : null, value })),
  });

  it('строки разбиения вместо категории и проекта; проценты — наибольшим остатком', () => {
    expect(body(draft({ amount: '1000', categoryId: 99, split: split('amount', '600', '400') })).lines).toEqual([
      { categoryId: 7, projectId: 8, amount: 60000 },
      { categoryId: 8, projectId: null, amount: 40000 },
    ]);
    expect(body(draft({ amount: '1', split: split('percent', '33,33', '33,33', '33,34') })).lines.map((l) => l.amount)).toEqual([33, 33, 34]);
  });

  it('сохранить можно, только когда остаток равен 0; у перевода разбиения нет', () => {
    expect(errors(draft({ amount: '1000', split: split('amount', '600', '300') }))).toEqual({ lines: 'Распределите всю сумму: остаток должен быть 0' });
    expect(errors(draft({ amount: '1000', split: split('amount', '600', '0', '400') }))).toEqual({ lines: 'Проверьте строки разбиения' });
    expect(errors(draft({ amount: '', split: split('amount', '600', '400') }))).toEqual({ amount: 'Введите сумму' });
    const t = draft({ type: 'transfer', toAccountId: 2, amount: '10', split: split('amount', '5', '5') });
    expect(body(t).lines).toEqual([]);
  });
});

describe('changeType, similarDraft, transferRateText', () => {
  it('смена типа сбрасывает категорию; у перевода нет контрагента; из перевода — без счёта зачисления', () => {
    const d = draft({ amount: '5', categoryId: 7, counterpartyId: 9, projectId: 8, comment: 'к' });
    expect(changeType(d, 'income')).toMatchObject({ type: 'income', amount: '5', categoryId: null, counterpartyId: 9, projectId: 8, comment: 'к' });
    const t = changeType(d, 'transfer');
    expect(t).toMatchObject({ type: 'transfer', categoryId: null, counterpartyId: null });
    expect(changeType({ ...t, toAccountId: 2, toAmount: '7' }, 'expense')).toMatchObject({ toAccountId: null, toAmount: '' });
    expect(changeType(d, 'expense')).toBe(d);
  });

  it('«создать похожий» — без суммы и комментария, остальное как было', () => {
    const d = draft({ amount: '5', toAmount: '6', comment: 'к', categoryId: 7, tagIds: [1], paidDate: '2026-10-01' });
    expect(similarDraft(d)).toEqual({ ...d, amount: '', toAmount: '', comment: '' });
    const percent = { mode: 'percent' as const, lines: [newLine({ categoryId: 7, value: '60' }), newLine({ categoryId: 8, value: '40' })] };
    expect(similarDraft(draft({ split: percent })).split).toBe(percent);
    const amounts = { mode: 'amount' as const, lines: [newLine({ categoryId: 7, value: '60' })] };
    expect(similarDraft(draft({ split: amounts })).split!.lines[0]).toMatchObject({ categoryId: 7, value: '' });
    expect(changeType(draft({ split: amounts }), 'income').split).toBeNull();
  });

  it('курс перевода — за единицу более дорогой валюты, 10 значащих цифр', () => {
    expect(transferRateText(5000000, 'KZT', 10000, 'USD')).toBe('1 USD = 500 KZT');
    expect(transferRateText(10000, 'USD', 4751200, 'KZT')).toBe('1 USD = 475,12 KZT');
    expect(transferRateText(100, 'KZT', 3, 'JPY')).toBe('1 KZT = 3 JPY');
    expect(transferRateText(30000, 'KZT', 100, 'CNY')).toBe('1 CNY = 300 KZT');
    expect(transferRateText(100000, 'KZT', 2100, 'KWD')).toBe('1 KWD = 476,1904762 KZT');
    expect(transferRateText(0, 'KZT', 10000, 'USD')).toBeNull();
    expect(transferRateText(100, 'KZT', 100, 'KZT')).toBeNull();
  });
});
