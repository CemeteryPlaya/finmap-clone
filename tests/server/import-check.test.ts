import { afterEach, describe, expect, it } from 'vitest';
import { checkImport, formatReport } from '../../scripts/lib/import-check';
import type { ImportPreview } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeRow as fr, finmapLikeXlsx } from '../helpers/finmap-like';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { ORIGIN_HEADERS } from '../helpers/test-app';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

/** Синтетический файл: доходы и расходы по «Кассе», перевод на новый «Банк-2», зарплата с подкатегорией, строка без категории, плановая строка. */
const ROWS = [
  fr({ paidAt: at('2026-09-20', '10:00:00'), amount: 10596, to: 'Касса', category: 'Бар' }),
  fr({ paidAt: at('2026-09-21', '10:00:00'), amount: 1000, to: 'Касса' }),
  fr({ paidAt: at('2026-10-03', '22:07:30'), amount: 8500, from: 'Касса', category: 'Зарплата', subcategory: 'Администраторы', counterparty: 'Сотрудник А' }),
  fr({ paidAt: at('2026-10-04', '09:15:00'), amount: 50000, from: 'Касса', to: 'Банк-2' }),
  fr({ paidAt: at('2026-10-05', '00:30:00'), amount: 8200.5, from: 'Банк-2', category: 'Связь' }),
  fr({ paidAt: at('2026-12-01', '10:00:00'), amount: 1, to: 'Касса', category: 'Бар' }),
];
const CTX = { timezone: 'Asia/Almaty', today: '2026-10-06', fileName: 'выгрузка.xlsx' };

async function importFile(rows = ROWS): Promise<void> {
  const up = await w.h.t.app.inject({
    method: 'POST',
    url: `/api/v1/companies/${w.cid}/imports/upload`,
    headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('выгрузка.xlsx') },
    payload: finmapLikeXlsx(rows),
  });
  const p = up.json() as ImportPreview;
  const res = await w.h.req('POST', `/api/v1/companies/${w.cid}/imports`, { token: p.token, accounts: [], revision: p.revision });
  expect(res.statusCode, res.body).toBe(201);
}

describe('сверка импорта npm run import:check (§12 спецификации импорта)', () => {
  it('после импорта — «Совпадает»: число операций, движение счетов и итоги по категориям; плановая строка не считается', async () => {
    w = await opsWorld();
    await importFile();
    const r = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx(ROWS), ...CTX });
    expect(r.today).toBe('2026-10-06');
    expect(r.rows).toEqual({ total: 6, future: 1, errors: 0 });
    expect(r.counts).toEqual([
      { what: 'доходы', file: 2, db: 2, currency: null },
      { what: 'расходы', file: 2, db: 2, currency: null },
      { what: 'переводы', file: 1, db: 1, currency: null },
    ]);
    expect(r.accounts).toEqual([
      { what: 'Касса, KZT', file: 1_159_600 - 850_000 - 5_000_000, db: 1_159_600 - 850_000 - 5_000_000, currency: 'KZT' },
      { what: 'Банк-2, KZT', file: 5_000_000 - 820_050, db: 5_000_000 - 820_050, currency: 'KZT' },
    ]);
    expect(r.categories.map((l) => [l.what, l.file, l.db])).toEqual([
      ['Доходы: Бар', 1_059_600, 1_059_600],
      ['Доходы: Без категории', 100_000, 100_000],
      ['Расходы: Зарплата → Администраторы', -850_000, -850_000],
      ['Расходы: Связь', -820_050, -820_050],
    ]);
    expect(r.notes).toEqual([]);
    expect(r.mismatches).toBe(0);
    expect(formatReport(r).at(-1)).toBe('Итог: Совпадает');
    expect(formatReport(r)[1]).toBe('Сегодня для разбора: 06.10.2026 — строки с датой платежа позже пропущены как плановые (--today ГГГГ-ММ-ДД — другая дата)');
    // другая «сегодня»: декабрьская строка уже не плановая — в файле на одну строку больше, чем в базе
    const later = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx(ROWS), ...CTX, today: '2026-12-31' });
    expect(later.rows.future).toBe(0);
    expect(later.counts[0]).toEqual({ what: 'доходы', file: 3, db: 2, currency: null });
  });

  it('одноимённые подкатегории разных родителей: одна строка сверки, в подписи — оба родителя', async () => {
    w = await opsWorld();
    const rows = [
      fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 100, from: 'Касса', category: 'Зарплата', subcategory: 'Администраторы' }),
      fr({ paidAt: at('2026-10-02', '11:00:00'), amount: 200, from: 'Касса', category: 'Офис', subcategory: 'Администраторы' }),
    ];
    await importFile(rows);
    const r = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx(rows), ...CTX });
    expect(r.categories).toEqual([{ what: 'Расходы: Зарплата → Администраторы + Офис → Администраторы', file: -30_000, db: -30_000, currency: 'KZT' }]);
    expect(r.mismatches).toBe(0);
    const text = formatReport(r);
    // длинная подпись не обрезается: числа — строкой ниже
    expect(text).toContain('  Расходы: Зарплата → Администраторы + Офис → Администраторы');
  });

  it('операция, добавленная после импорта, — расхождения по счёту и категории; строка с неизвестным счётом — предупреждение', async () => {
    w = await opsWorld();
    await importFile();
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T05:00:00Z', accountId: w.kzt, amount: 777, lines: [{ categoryId: w.income, projectId: null, amount: 777 }] });
    const r = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx([...ROWS, fr({ paidAt: at('2026-10-01'), amount: 5, to: 'Сейф' })]), ...CTX });
    // «Касса» и «Доходы: Бар»; число доходов совпало случайно (строка «Сейфа» в файле, лишняя операция в базе)
    expect(r.mismatches).toBe(2);
    expect(r.counts[0]).toEqual({ what: 'доходы', file: 3, db: 3, currency: null });
    expect(r.accounts[0]).toMatchObject({ what: 'Касса, KZT', db: r.accounts[0]!.file + 777 });
    expect(r.notes).toEqual(['Нет счёта в компании для: Сейф — их строки не сверялись']);
    const text = formatReport(r);
    expect(text.at(-1)).toBe('Итог: Расхождений: 2');
    expect(text.some((l) => l.startsWith('≠ Доходы: Бар'))).toBe(true);
  });

  it('ошибка файла — тем же текстом, что в панели; нет компании — понятная ошибка', async () => {
    w = await opsWorld();
    expect(() => checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: Buffer.from('%PDF-1.4'), ...CTX, fileName: 'отчёт.pdf' })).toThrow('Нужен файл .xlsx или .csv');
    expect(() => checkImport({ sqlite: w.h.t.sqlite, companyId: 999_999, data: finmapLikeXlsx(ROWS), ...CTX })).toThrow('Компании с id 999999 нет');
  });
});
