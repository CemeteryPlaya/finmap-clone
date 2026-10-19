import { describe, expect, it } from 'vitest';
import type { StockDoc } from '../../src/client/lib/stock';
import {
  buildDocBody,
  docSubmitLabel,
  docTitle,
  draftFromDoc,
  draftTotal,
  emptyDocDraft,
  impactText,
  isBlankLine,
  mapServerLineErrors,
  newDocLine,
  paymentLabel,
  paymentState,
  paymentSummary,
  repriceSaleLines,
  setLineAmount,
  setLineItem,
  setLinePrice,
  setLineQty,
  type DocContext,
  type DocDraft,
  type ItemInfo,
} from '../../src/client/lib/stock-doc-form';

const TZ = 'Asia/Almaty';
const NOW = new Date('2026-10-06T12:00:00.000Z'); // 17:00, 06.10.2026
const cola: ItemInfo = { id: 1, unit: 'pcs', prices: [{ price: 50_000, validFrom: '2026-09-01' }, { price: 55_000, validFrom: '2026-10-05' }] };
const syrup: ItemInfo = { id: 2, unit: 'l', prices: [] };
const items = new Map([cola, syrup].map((i) => [i.id, i]));
const ctx = (over: Partial<DocContext> = {}): DocContext => ({ items, currency: 'KZT', today: '2026-10-06', timeZone: TZ, now: NOW, timeOfDayFrom: NOW, ...over });

const line = (over: Partial<ReturnType<typeof newDocLine>> = {}) => ({ ...newDocLine(), ...over });

describe('связь цены и суммы строки', () => {
  it('цена × количество = сумма, до тиына', () => {
    const l = setLinePrice(line({ qty: '3' }), '33,33', 'pcs', 'KZT');
    expect(l).toMatchObject({ price: '33,33', amount: '99,99', driver: 'price' });
    expect(setLinePrice(line({ qty: '1,5' }), '10', 'l', 'KZT').amount).toBe('15');
  });

  it('сумма / количество = цена; сумма остаётся ровно той, что ввели', () => {
    const l = setLineAmount(line({ qty: '3' }), '100', 'pcs', 'KZT');
    expect(l).toMatchObject({ amount: '100', price: '33,33', driver: 'amount' });
  });

  it('смена количества: после правки цены пересчитывается сумма, после правки суммы — цена', () => {
    const byPrice = setLineQty(setLinePrice(line({ qty: '2' }), '10', 'pcs', 'KZT'), '5', 'pcs', 'KZT');
    expect(byPrice).toMatchObject({ qty: '5', price: '10', amount: '50' });
    const byAmount = setLineQty(setLineAmount(line({ qty: '2' }), '100', 'pcs', 'KZT'), '4', 'pcs', 'KZT');
    expect(byAmount).toMatchObject({ qty: '4', amount: '100', price: '25' });
  });

  it('пока количество не разобрано, второе поле не трогается; пустое поле очищает связанное', () => {
    expect(setLinePrice(line({ qty: '' }), '10', 'pcs', 'KZT').amount).toBe('');
    expect(setLineQty(line({ price: '10' }), '1,5', 'pcs', 'KZT')).toMatchObject({ qty: '1,5', amount: '' }); // у штук дроби нет
    expect(setLineAmount(setLineAmount(line({ qty: '2' }), '50', 'pcs', 'KZT'), '', 'pcs', 'KZT')).toMatchObject({ amount: '', price: '' });
    expect(setLinePrice(setLinePrice(line({ qty: '2' }), '10', 'pcs', 'KZT'), '', 'pcs', 'KZT')).toMatchObject({ price: '', amount: '' });
  });

  it('выбор товара в продаже подставляет цену продажи на дату документа', () => {
    expect(setLineItem(line({ qty: '2' }), 1, cola, 'sale', '2026-10-06', 'KZT')).toMatchObject({ itemId: 1, price: '550', amount: '1100' });
    expect(setLineItem(line({ qty: '2' }), 1, cola, 'sale', '2026-10-01', 'KZT')).toMatchObject({ price: '500', amount: '1000' });
    expect(setLineItem(line({ qty: '2' }), 1, cola, 'sale', '2026-08-01', 'KZT')).toMatchObject({ itemId: 1, price: '', amount: '' }); // цены тогда ещё не было
    expect(setLineItem(line(), 1, cola, 'sale', '2026-10-06', 'KZT')).toMatchObject({ price: '550', amount: '' });
    expect(setLineItem(line(), 1, cola, 'receipt', '2026-10-06', 'KZT')).toMatchObject({ itemId: 1, price: '' });
    expect(setLineItem(line({ itemId: 1 }), null, undefined, 'sale', '2026-10-06', 'KZT').itemId).toBeNull();
  });

  it('итог — сумма разобранных сумм строк', () => {
    const d = { lines: [line({ amount: '100,50' }), line({ amount: '' }), line({ amount: 'x' }), line({ amount: '2' })] };
    expect(draftTotal(d, 'KZT')).toBe(10_250);
    expect(isBlankLine(line())).toBe(true);
    expect(isBlankLine(line({ qty: '1' }))).toBe(false);
  });
});

describe('смена даты продажи пересчитывает цену (R5)', () => {
  it('нетронутые строки берут цену продажи на новую дату; правленные остаются', () => {
    const auto = setLineItem(line({ qty: '2' }), 1, cola, 'sale', '2026-10-06', 'KZT');
    const edited = setLinePrice(setLineItem(line({ qty: '2' }), 1, cola, 'sale', '2026-10-06', 'KZT'), '700', 'pcs', 'KZT');
    expect(auto.edited).toBe(false);
    expect(edited.edited).toBe(true);
    const empty = line();
    const [a, e, blank] = repriceSaleLines([auto, edited, empty], items, '2026-10-01', 'KZT');
    expect(a).toMatchObject({ price: '500', amount: '1000', edited: false });
    expect(e).toMatchObject({ price: '700', amount: '1400' });
    expect(blank).toBe(empty);
    expect(repriceSaleLines([auto], items, '2026-08-01', 'KZT')[0]).toMatchObject({ price: '', amount: '' });
  });
});

describe('buildDocBody', () => {
  const base = (over: Partial<DocDraft> = {}): DocDraft => ({
    ...emptyDocDraft('receipt', '2026-10-06', 7),
    counterpartyId: 3,
    lines: [line({ itemId: 1, qty: '10', price: '100', amount: '1000', driver: 'price' }), line()],
    ...over,
  });

  it('поступление: пустые строки пропускаются, количество и суммы — в тысячных и тиынах, момент — «сейчас»', () => {
    const r = buildDocBody(base(), ctx());
    expect(r).toEqual({
      ok: true,
      body: {
        type: 'receipt',
        at: '2026-10-06T12:00:00.000Z',
        warehouseId: 7,
        toWarehouseId: null,
        counterpartyId: 3,
        reason: null,
        comment: null,
        lines: [{ itemId: 1, qty: 10_000, amount: 100_000 }],
      },
    });
  });

  it('перемещение: склад-получатель обязателен и другой; без сумм, контрагента и причины (Склад-2)', () => {
    const d = base({ type: 'transfer', toWarehouseId: 8, counterpartyId: 3, lines: [line({ itemId: 1, qty: '4', amount: '999' })] });
    expect(buildDocBody(d, ctx())).toMatchObject({
      ok: true,
      body: { type: 'transfer', warehouseId: 7, toWarehouseId: 8, counterpartyId: null, reason: null, lines: [{ itemId: 1, qty: 4000, amount: null }] },
    });
    expect(buildDocBody({ ...d, toWarehouseId: null }, ctx())).toEqual({ ok: false, errors: { toWarehouseId: 'Выберите склад-получатель' } });
    expect(buildDocBody({ ...d, toWarehouseId: 7 }, ctx())).toEqual({ ok: false, errors: { toWarehouseId: 'Склад-получатель совпадает с отправителем' } });
    // у других типов получатель не уходит, даже если остался в черновике
    expect(buildDocBody(base({ toWarehouseId: 8 }), ctx())).toMatchObject({ ok: true, body: { toWarehouseId: null } });
    expect(docTitle('transfer', null)).toBe('Новое перемещение');
    expect(emptyDocDraft('transfer', '2026-10-06', 7)).toMatchObject({ toWarehouseId: null, reason: null });
  });

  it('литры с дробью; продажа несёт контрагента; комментарий очищается', () => {
    const r = buildDocBody(base({ type: 'sale', comment: '  смена 1 ', lines: [line({ itemId: 2, qty: '1,5', amount: '12,5' })] }), ctx());
    expect(r).toMatchObject({ ok: true, body: { type: 'sale', comment: 'смена 1', counterpartyId: 3, lines: [{ itemId: 2, qty: 1500, amount: 1250 }] } });
  });

  it('списание: без сумм и контрагента, причина обязательна', () => {
    const d = base({ type: 'writeoff', reason: 'spoiled', counterpartyId: 3, lines: [line({ itemId: 1, qty: '2', amount: '999' })] });
    expect(buildDocBody(d, ctx())).toMatchObject({ ok: true, body: { type: 'writeoff', reason: 'spoiled', counterpartyId: null, lines: [{ itemId: 1, qty: 2000, amount: null }] } });
    expect(buildDocBody({ ...d, reason: null }, ctx())).toEqual({ ok: false, errors: { reason: 'Укажите причину списания' } });
  });

  it('ошибки по полям: склад, товар, количество штук, сумма, пустой документ', () => {
    expect(buildDocBody(base({ warehouseId: null }), ctx())).toEqual({ ok: false, errors: { warehouseId: 'Выберите склад' } });
    expect(buildDocBody(base({ lines: [line(), line()] }), ctx())).toEqual({ ok: false, errors: { lines: 'Добавьте хотя бы одну строку' } });
    const r = buildDocBody(base({ lines: [line({ qty: '1' }), line({ itemId: 1, qty: '1,5', amount: '' }), line({ itemId: 2, qty: '', amount: '-1' })] }), ctx());
    expect(r).toEqual({
      ok: false,
      errors: {
        'lines.0.itemId': 'Выберите товар',
        'lines.1.qty': 'Количество в штуках — целое',
        'lines.1.amount': 'Укажите сумму',
        'lines.2.qty': 'Введите количество',
        'lines.2.amount': 'Сумма не меньше нуля',
      },
    });
  });

  it('дата: будущая — ошибка; руками заданное время позже «сейчас» — ошибка; прошлый день сохраняет время суток', () => {
    expect(buildDocBody(base({ paidDate: '2026-10-07', paidDateSet: true }), ctx())).toMatchObject({ ok: false, errors: { at: 'Дата документа в будущем — так нельзя' } });
    expect(buildDocBody(base({ paidTime: '23:30', paidTimeSet: true }), ctx())).toMatchObject({ ok: false, errors: { at: 'Это время ещё не наступило' } });
    expect(buildDocBody(base({ paidTime: '25:00', paidTimeSet: true }), ctx())).toMatchObject({ ok: false, errors: { at: 'Укажите время в виде ЧЧ:ММ' } });
    const past = buildDocBody(base({ paidDate: '2026-10-01', paidDateSet: true }), ctx());
    expect(past).toMatchObject({ ok: true, body: { at: '2026-10-01T12:00:00.000Z' } });
    const timed = buildDocBody(base({ paidDate: '2026-10-01', paidDateSet: true, paidTime: '09:15', paidTimeSet: true }), ctx());
    expect(timed).toMatchObject({ ok: true, body: { at: '2026-10-01T04:15:00.000Z' } }); // 09:15 по Алматы (UTC+5)
  });

  it('правка без смены даты и времени: момент документа как есть, с секундами', () => {
    const d = base({ paidDate: '2026-10-05', paidDateSet: true, paidTime: '10:00' });
    const r = buildDocBody(d, ctx({ originalAt: '2026-10-05T05:00:07.123Z', timeOfDayFrom: new Date('2026-10-05T05:00:07.123Z') }));
    expect(r).toMatchObject({ ok: true, body: { at: '2026-10-05T05:00:07.123Z' } });
  });
});

describe('draftFromDoc', () => {
  it('сумма и количество — текст полей, цена = сумма / количество, момент — день и время по поясу', () => {
    const doc = {
      id: 5,
      type: 'sale',
      number: 'Р-0001',
      at: '2026-10-05T05:30:00.000Z',
      warehouseId: 7,
      toWarehouseId: null,
      counterpartyId: 3,
      reason: null,
      comment: 'смена',
      version: 2,
      status: 'posted',
      total: 0,
      linesCount: 1,
      paid: 0,
      posted: false,
      lines: [{ id: 1, position: 0, itemId: 2, qty: 1500, amount: 1250, cost: null, uncovered: 0 }],
      payments: [],
      posting: null,
      lastPost: null,
      deletedAt: null,
    } as StockDoc;
    const d = draftFromDoc(doc, items, 'KZT', TZ);
    expect(d).toMatchObject({ type: 'sale', warehouseId: 7, counterpartyId: 3, paidDate: '2026-10-05', paidDateSet: true, paidTime: '10:30', paidTimeSet: false, comment: 'смена' });
    expect(d.lines[0]).toMatchObject({ itemId: 2, qty: '1,5', amount: '12,5', price: '8,33', driver: 'amount' });
  });
});

describe('тексты', () => {
  it('заголовок и кнопка', () => {
    expect(docTitle('receipt', null)).toBe('Новое поступление');
    expect(docTitle('sale', 'Р-0003')).toBe('Продажа Р-0003');
    expect(docTitle('writeoff', null)).toBe('Новое списание');
    expect(docSubmitLabel('sale', false)).toBe('Добавить продажу');
    expect(docSubmitLabel('sale', true)).toBe('Сохранить изменения');
  });

  it('предупреждение о себестоимости: числа в родительном падеже, дата по поясу', () => {
    const since = '2026-10-01T10:00:00.000Z';
    expect(impactText({ sales: 0, writeoffs: 0, since: null }, TZ)).toBeNull();
    expect(impactText({ sales: 1, writeoffs: 0, since }, TZ)).toBe('Изменится себестоимость 1 продажи после 01.10.2026');
    expect(impactText({ sales: 3, writeoffs: 0, since }, TZ)).toBe('Изменится себестоимость 3 продаж после 01.10.2026');
    expect(impactText({ sales: 21, writeoffs: 1, since }, TZ)).toBe('Изменится себестоимость 21 продажи и 1 списания после 01.10.2026');
    expect(impactText({ sales: 0, writeoffs: 5, since }, TZ)).toBe('Изменится себестоимость 5 списаний после 01.10.2026');
  });

  it('состояние оплаты поступления', () => {
    expect(paymentState(100, 0)).toEqual({ kind: 'none', debt: 100 });
    expect(paymentState(100, 40)).toEqual({ kind: 'partial', debt: 60 });
    expect(paymentState(100, 100)).toEqual({ kind: 'paid', debt: 0 });
    expect(paymentState(100, 130)).toEqual({ kind: 'over', debt: -30 });
  });

  it('подписи оплаты: в списке и в окне поступления', () => {
    const nb = String.fromCharCode(0xa0);
    const narrow = String.fromCharCode(0x202f);
    const k = (n: string, tail = '') => n.replace(' ', narrow) + nb + '₸' + tail;
    expect(paymentLabel(100_000, 0, 'KZT')).toBe('Долг ' + k('1 000'));
    expect(paymentLabel(100_000, 40_000, 'KZT')).toBe('Оплачено ' + k('400') + ' из ' + k('1 000'));
    expect(paymentLabel(100_000, 100_000, 'KZT')).toBe('Оплачено');
    expect(paymentLabel(100_000, 130_000, 'KZT')).toBe('Переплата ' + k('300'));
    expect(paymentSummary(100_000, 0, 'KZT')).toBe('Не оплачено. Долг ' + k('1 000'));
    expect(paymentSummary(100_000, 40_000, 'KZT')).toBe('Оплачено ' + k('400') + ' из ' + k('1 000') + '. Долг ' + k('600'));
    expect(paymentSummary(100_000, 100_000, 'KZT')).toBe('Оплачено ' + k('1 000') + ' из ' + k('1 000'));
    expect(paymentSummary(100_000, 130_000, 'KZT')).toBe('Оплачено ' + k('1 300') + ' из ' + k('1 000') + '. Переплата ' + k('300'));
  });
});

describe('правки финальной волны (R14, R15, R18)', () => {
  it('R14: товар без цены на дату очищает прежние цену и сумму, если их не правили руками', () => {
    const picked = setLineItem(line({ qty: '2' }), 1, cola, 'sale', '2026-10-06', 'KZT');
    expect(picked).toMatchObject({ price: '550', amount: '1100' });
    const noPrice = setLineItem(picked, 2, { ...syrup, unit: 'pcs' }, 'sale', '2026-10-06', 'KZT');
    expect(noPrice).toMatchObject({ itemId: 2, price: '', amount: '', driver: 'price', edited: false });
  });

  it('R14: правленную руками цену товар без цены не трогает', () => {
    const typed = setLinePrice(line({ qty: '2' }), '700', 'pcs', 'KZT');
    expect(setLineItem(typed, 2, { ...syrup, unit: 'pcs' }, 'sale', '2026-10-06', 'KZT')).toMatchObject({ itemId: 2, price: '700', amount: '1400' });
  });

  it('R15: неразобранное количество очищает зависимую сумму (или цену, если последней правили сумму)', () => {
    const byPrice = setLinePrice(line({ qty: '2' }), '10', 'pcs', 'KZT');
    expect(setLineQty(byPrice, '1,5', 'pcs', 'KZT')).toMatchObject({ qty: '1,5', price: '10', amount: '' });
    const byAmount = setLineAmount(line({ qty: '2' }), '100', 'pcs', 'KZT');
    expect(setLineQty(byAmount, '1,5', 'pcs', 'KZT')).toMatchObject({ qty: '1,5', price: '', amount: '100' });
  });

  it('R18: ошибки сервера lines.N.* переводятся из номеров без пустых строк в номера строк формы', () => {
    const lines = [line(), line({ itemId: 1, qty: '1' }), line(), line({ itemId: 2, qty: '2' })];
    expect(mapServerLineErrors({ 'lines.0.qty': 'a', 'lines.1.amount': 'b', warehouseId: 'c', 'lines.5.qty': 'd' }, lines)).toEqual({
      'lines.1.qty': 'a',
      'lines.3.amount': 'b',
      warehouseId: 'c',
      'lines.5.qty': 'd',
    });
  });
});
