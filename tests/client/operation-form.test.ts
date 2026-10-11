import { describe, expect, it } from 'vitest';
import {
  buildBody,
  changeType,
  emptyDraft,
  initialFocusField,
  FIELD_LABELS,
  operationTitle,
  paidAtFor,
  shownPaidTime,
  similarDraft,
  submitLabel,
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

describe('окно по типу (§6.1, §6.2, §6.9 этапа 1.5)', () => {
  it('заголовок: «Новый доход» при создании, «Доход» при правке', () => {
    expect(operationTitle('income', false)).toBe('Новый доход');
    expect(operationTitle('expense', false)).toBe('Новый расход');
    expect(operationTitle('transfer', false)).toBe('Новый перевод');
    expect(operationTitle('income', true)).toBe('Доход');
    expect(operationTitle('expense', true)).toBe('Расход');
    expect(operationTitle('transfer', true)).toBe('Перевод');
  });

  it('главная кнопка: «Добавить доход / расход / перевод», при правке — «Сохранить изменения»', () => {
    expect(submitLabel('income', false)).toBe('Добавить доход');
    expect(submitLabel('expense', false)).toBe('Добавить расход');
    expect(submitLabel('transfer', false)).toBe('Добавить перевод');
    expect(submitLabel('transfer', true)).toBe('Сохранить изменения');
  });

  it('подписи счёта и даты оплаты — как в Finmap', () => {
    expect(FIELD_LABELS).toEqual({
      income: { account: 'На счёт', paidDate: 'Дата поступления денег' },
      expense: { account: 'Со счёта', paidDate: 'Указать дату списания' },
      transfer: { account: 'Со счёта', paidDate: 'Дата перевода денег' },
    });
  });
});

describe('фокус при открытии (§6.2 этапа 1.5)', () => {
  it('первое пустое обязательное поле: счёт (у перевода — «Со счёта», затем «На счёт»), иначе сумма; при правке — сумма', () => {
    expect(initialFocusField(emptyDraft('expense', '2026-10-07'), false)).toBe('accountId');
    expect(initialFocusField(emptyDraft('expense', '2026-10-07', 1), false)).toBe('amount');
    expect(initialFocusField(emptyDraft('transfer', '2026-10-07', 1), false)).toBe('toAccountId');
    expect(initialFocusField(emptyDraft('transfer', '2026-10-07', 1, 2), false)).toBe('amount');
    expect(initialFocusField(emptyDraft('transfer', '2026-10-07', null, 2), false)).toBe('accountId');
    expect(initialFocusField(emptyDraft('income', '2026-10-07'), true)).toBe('amount');
  });
});

describe('время оплаты (§2.3 этапа 1.5)', () => {
  it('paidAtFor с явным временем — дата и ЧЧ:ММ:00 в поясе приложения, без ограничения «не позже now»', () => {
    expect(paidAtFor('2026-10-06', NOW, NOW, TZ, '22:09')).toBe('2026-10-06T17:09:00.000Z');
    expect(paidAtFor('2026-10-07', NOW, NOW, TZ, '23:59')).toBe('2026-10-07T18:59:00.000Z');
    expect(paidAtFor('2026-10-07', NOW, NOW, TZ, '00:05')).toBe('2026-10-06T19:05:00.000Z');
    // до 01.03.2024 в Алматы было UTC+6 (Review Focus 2)
    expect(paidAtFor('2024-01-15', NOW, NOW, TZ, '09:05')).toBe('2024-01-15T03:05:00.000Z');
  });

  it('время не трогали — «живое»: сегодня — точный момент сохранения, другая дата — текущее время суток', () => {
    expect(emptyDraft('expense', '2026-10-07')).toMatchObject({ paidTime: '', paidTimeSet: false });
    expect(body(draft({ amount: '1' })).paidAt).toBe(NOW.toISOString());
    expect(body(draft({ amount: '1', paidDate: '2026-10-05' })).paidAt).toBe('2026-10-05T05:30:00.123Z');
  });

  it('время задано руками: в теле — дата и ЧЧ:ММ:00; позже «сейчас» сегодня — ошибка; в прошлый день — можно (Review Focus 3)', () => {
    expect(body(draft({ amount: '1', paidDate: '2026-10-06', paidTime: '22:09', paidTimeSet: true })).paidAt).toBe('2026-10-06T17:09:00.000Z');
    expect(body(draft({ amount: '1', paidTime: '10:30', paidTimeSet: true })).paidAt).toBe('2026-10-07T05:30:00.000Z');
    expect(errors(draft({ amount: '1', paidTime: '10:31', paidTimeSet: true }))).toEqual({ paidAt: 'Это время ещё не наступило' });
    expect(errors(draft({ amount: '1', paidTime: '25:00', paidTimeSet: true }))).toEqual({ paidAt: 'Укажите время в виде ЧЧ:ММ' });
  });

  it('правка: та же дата, время не трогали — paidAt операции как есть, даже если он позже «сейчас» (Review Focus 1)', () => {
    const later = '2026-10-07T10:00:00.250Z'; // 15:00 по Алматы — позже NOW (10:30)
    const d = draft({ amount: '1', paidDate: '2026-10-07', paidTime: '15:00' });
    expect(buildBody(d, { ...ctx, timeOfDayFrom: new Date(later), originalPaidAt: later })).toMatchObject({ ok: true, body: { paidAt: later } });
    // дату перенесли — прежнее время суток, но не позже «сейчас»
    const moved = draft({ amount: '1', paidDate: '2026-10-07', paidTime: '18:15' });
    expect(buildBody(moved, { ...ctx, timeOfDayFrom: new Date('2026-10-05T13:15:42.250Z'), originalPaidAt: '2026-10-05T13:15:42.250Z' })).toMatchObject({
      ok: true,
      body: { paidAt: NOW.toISOString() },
    });
  });

  it('правка: дата операции «в будущем» из-за часов устройства не блокирует сохранение, если дату не меняли; перенос на будущий день — ошибка', () => {
    const skewed = '2026-10-08T05:30:00.250Z'; // 08.10 по Алматы, а «сегодня» устройства — 07.10
    const d = draft({ amount: '1', paidDate: '2026-10-08', paidTime: '10:30' });
    expect(buildBody(d, { ...ctx, timeOfDayFrom: new Date(skewed), originalPaidAt: skewed })).toMatchObject({ ok: true, body: { paidAt: skewed } });
    // новая операция и правка с переносом на будущий день — по-прежнему ошибка
    expect(errors(d)).toEqual({ paidAt: 'Дата оплаты в будущем — так нельзя' });
    const moved = draft({ amount: '1', paidDate: '2026-10-09', paidTime: '10:30' });
    expect(buildBody(moved, { ...ctx, timeOfDayFrom: new Date(skewed), originalPaidAt: skewed })).toMatchObject({
      ok: false,
      errors: { paidAt: 'Дата оплаты в будущем — так нельзя' },
    });
  });

  it('время в поле — то, что сохранится (shownPaidTime)', () => {
    const edit = { paidDate: '2026-10-05', paidTime: '18:15', paidTimeSet: false };
    expect(shownPaidTime({ paidDate: '2026-10-07', paidTime: '', paidTimeSet: false }, '10:30', '2026-10-07', null)).toBe('10:30');
    expect(shownPaidTime(edit, '10:30', '2026-10-07', '2026-10-05')).toBe('18:15');
    // перенос на сегодня, время ещё не наступило — сохранится «сейчас», его и показываем
    expect(shownPaidTime({ ...edit, paidDate: '2026-10-07' }, '10:30', '2026-10-07', '2026-10-05')).toBe('10:30');
    expect(shownPaidTime({ ...edit, paidDate: '2026-10-06' }, '10:30', '2026-10-07', '2026-10-05')).toBe('18:15');
    // сохранённое время позже «сейчас» в тот же день — без изменений
    expect(shownPaidTime({ paidDate: '2026-10-07', paidTime: '15:00', paidTimeSet: false }, '10:30', '2026-10-07', '2026-10-07')).toBe('15:00');
    expect(shownPaidTime({ ...edit, paidTime: '09:05', paidTimeSet: true }, '10:30', '2026-10-07', '2026-10-05')).toBe('09:05');
  });

  it('«создать похожий»: время, заданное руками, и дата переносятся; «живое» время остаётся живым', () => {
    const manual = draft({ amount: '5', paidDate: '2026-10-06', paidTime: '22:09', paidTimeSet: true });
    expect(similarDraft(manual)).toMatchObject({ paidDate: '2026-10-06', paidTime: '22:09', paidTimeSet: true, amount: '' });
    const fromEdit = draft({ amount: '5', paidDate: '2026-10-06', paidTime: '18:15', paidTimeSet: false });
    expect(similarDraft(fromEdit)).toMatchObject({ paidDate: '2026-10-06', paidTime: '', paidTimeSet: false });
  });
});
