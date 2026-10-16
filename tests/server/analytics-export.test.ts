import { afterEach, describe, expect, it } from 'vitest';
import { reportSheet } from '../../src/server/modules/analytics/report-export';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { sheetRows } from '../helpers/xlsx-rows';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const OCTOBER = 'from=2026-10-01&to=2026-10-31&step=week';

/**
 * Октябрь 2026 по неделям: доход 1 000 ₸ «Бар» 2 октября, разбитый расход 300 ₸ 5 октября — 200 ₸ «Аренда» и 100 ₸
 * подкатегории «Закуп бара → Кола».
 */
async function october() {
  w = await opsWorld();
  const c = `/api/v1/companies/${w.cid}/categories`;
  const supply = (await w.post(c, { kind: 'expense', name: 'Закуп бара' })).category.id as number;
  const cola = (await w.post(c, { kind: 'expense', name: 'Кола', parentId: supply })).category.id as number;
  await w.post(w.ops, { type: 'income', paidAt: '2026-10-02T05:00:00Z', accountId: w.kzt, amount: 100_000, lines: [{ categoryId: w.income, amount: 100_000 }] });
  await w.post(w.ops, {
    type: 'expense',
    paidAt: '2026-10-05T05:00:00Z',
    accountId: w.kzt,
    amount: 30_000,
    lines: [
      { categoryId: w.expense, amount: 20_000 },
      { categoryId: cola, amount: 10_000 },
    ],
  });
}

const download = async (url: string) => {
  const res = await w.h.req('GET', url);
  expect(res.statusCode, res.body).toBe(200);
  return res;
};
/** Строка листа по названию (без отступа): ячейки как текст. */
const line = (rows: string[][], label: string) => rows.find((r) => r[0]!.trim() === label)!;

describe('Excel отчётов: GET …/analytics/{cashflow|pnl}.xlsx (§2.6)', () => {
  it('«Деньги»: колонки и строки как в таблице, все строки раскрыты, вложенность — отступом; имя файла, заголовки ответа', async () => {
    await october();
    const res = await download(`/api/v1/companies/${w.cid}/analytics/cashflow.xlsx?${OCTOBER}`);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['cache-control']).toBe('private, no-store');
    // «{Компания} - Деньги - ДД-ММ-ГГГГ ЧЧ-ММ.xlsx» по часам Алматы: «сейчас» — 06.10.2026 17:00
    expect(decodeURIComponent(String(res.headers['content-disposition']))).toContain('ТОО - Деньги - 06-10-2026 17-00.xlsx');
    const rows = sheetRows(res.rawPayload);
    expect(rows[0]).toEqual(['Название', '1–4 окт', '5–11 окт', '12–18 окт', '19–25 окт', '26–31 окт', 'Итого']);
    const labels = rows.slice(1).map((r) => r[0]);
    expect(labels.slice(0, 9)).toEqual([
      'Остаток на начало периода',
      'Остаток на конец периода',
      'Неоперационные изменения остатка',
      '    Стартовые остатки',
      '    Переводы',
      '    Исключённые из отчёта счета',
      '    Курсовая разница',
      'Чистый денежный поток',
      'Поступления',
    ]);
    // подкатегория раскрыта и под родителем
    const at = labels.indexOf('    Закуп бара');
    expect(labels[at + 1]).toBe('        Кола');
    // суммы — числа в тенге с двумя знаками (формат валюты в ячейке)
    expect(line(rows, 'Закуп бара').slice(1)).toEqual(['0.00', '100.00', '0.00', '0.00', '0.00', '100.00']);
    expect(line(rows, 'Поступления').slice(1)).toEqual(['1000.00', '0.00', '0.00', '0.00', '0.00', '1000.00']);
    expect(line(rows, 'Остаток на конец периода').at(-1)).toBe('700.00');
  });

  it('с процентами — колонка «%» после каждой суммы, доля строки в группе; у остатков пусто', async () => {
    await october();
    const rows = sheetRows((await download(`/api/v1/companies/${w.cid}/analytics/cashflow.xlsx?from=2026-10-01&to=2026-10-31&pct=true`)).rawPayload);
    expect(rows[0]).toEqual(['Название', 'Октябрь 2026', '%', 'Итого', '%']);
    expect(line(rows, 'Аренда')).toEqual(['    Аренда', '200.00', '66.67', '200.00', '66.67']);
    expect(line(rows, 'Списания')).toEqual(['Списания', '300.00', '100.00', '300.00', '100.00']);
    expect(line(rows, 'Остаток на конец периода')).toEqual(['Остаток на конец периода', '700.00', '', '700.00', '']);
  });

  it('«Прибыль»: «Прибыль», «Доходы», «Расходы», имя файла; неверный период — 400 с полем', async () => {
    await october();
    const res = await download(`/api/v1/companies/${w.cid}/analytics/pnl.xlsx?${OCTOBER}`);
    expect(decodeURIComponent(String(res.headers['content-disposition']))).toContain('ТОО - Прибыль - 06-10-2026 17-00.xlsx');
    const rows = sheetRows(res.rawPayload);
    expect(rows.slice(1, 3).map((r) => r[0])).toEqual(['Прибыль', 'Доходы']);
    expect(line(rows, 'Прибыль').at(-1)).toBe('700.00');
    // «Инвестиции» — исключённая системная категория: её нет и в файле
    expect(rows.some((r) => r[0]!.trim() === 'Инвестиции')).toBe(false);
    const bad = await w.h.req('GET', `/api/v1/companies/${w.cid}/analytics/pnl.xlsx?from=2026-10-31&to=2026-10-01`);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields).toEqual({ to: 'Конец периода раньше начала' });
  });

  it('лист: нет значения — пустая ячейка; пояснение строки — после названия; архивная — с пометкой', () => {
    const sheet = reportSheet({
      name: 'Деньги',
      columns: [{ key: '2026-10-01', from: '2026-10-01', to: '2026-10-31', label: 'Октябрь 2026' }],
      rows: [
        { id: 'balance:start', kind: 'balance', label: 'Остаток на начало периода', values: [null], total: null, note: 'Нет курса USD на 30.09.2026' },
        { id: 'income', kind: 'group', label: 'Поступления', values: [1500], total: 1500, children: [{ id: 'income:category:5', kind: 'category', label: 'Старая', values: [1500], total: 1500, archived: true }] },
      ],
      currency: 'KZT',
      percent: false,
    });
    expect(sheet.rows).toEqual([
      [{ kind: 'text', value: 'Остаток на начало периода — Нет курса USD на 30.09.2026', bold: true }, null, null],
      [
        { kind: 'text', value: 'Поступления', bold: true },
        { kind: 'number', value: '15.00', decimals: 2, bold: true },
        { kind: 'number', value: '15.00', decimals: 2, bold: true },
      ],
      [
        { kind: 'text', value: '    Старая (архив)', bold: false },
        { kind: 'number', value: '15.00', decimals: 2, bold: false },
        { kind: 'number', value: '15.00', decimals: 2, bold: false },
      ],
    ]);
  });
});
