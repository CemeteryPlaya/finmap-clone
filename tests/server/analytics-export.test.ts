import { afterEach, describe, expect, it } from 'vitest';
import { reportSheet } from '../../src/server/modules/analytics/report-export';
import { HIDDEN_BALANCES_TEXT } from '../../src/shared/report-engine';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { stockWorld } from '../helpers/stock';
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
/** Лист = строки сведений (R13), пустая строка (читатель пустых строк не отдаёт) и таблица, которая начинается с заголовка «Название». */
const sheet = (data: Buffer) => {
  const all = sheetRows(data);
  const at = all.findIndex((r) => r[0] === 'Название');
  expect(at, 'в листе нет строки заголовков').toBeGreaterThan(0);
  return { info: all.slice(0, at).map((r) => r[0]!), rows: all.slice(at) };
};

describe('Excel отчётов: GET …/analytics/{cashflow|pnl}.xlsx (§2.6)', () => {
  it('«Деньги»: колонки и строки как в таблице, все строки раскрыты, вложенность — отступом; имя файла, заголовки ответа', async () => {
    await october();
    const res = await download(`/api/v1/companies/${w.cid}/analytics/cashflow.xlsx?${OCTOBER}`);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['cache-control']).toBe('private, no-store');
    // «{Компания} - Деньги - ДД-ММ-ГГГГ ЧЧ-ММ.xlsx» по часам Алматы: «сейчас» — 06.10.2026 17:00
    expect(decodeURIComponent(String(res.headers['content-disposition']))).toContain('ТОО - Деньги - 06-10-2026 17-00.xlsx');
    const { info, rows } = sheet(res.rawPayload);
    expect(info).toEqual(['Отчёт: Деньги', 'Период: 01.10.2026 – 31.10.2026', 'Шаг: по неделям', 'Разрез: по категориям', 'Фильтры: нет']);
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
    const { rows } = sheet((await download(`/api/v1/companies/${w.cid}/analytics/cashflow.xlsx?from=2026-10-01&to=2026-10-31&pct=true`)).rawPayload);
    expect(rows[0]).toEqual(['Название', 'Октябрь 2026', '%', 'Итого', '%']);
    expect(line(rows, 'Аренда')).toEqual(['    Аренда', '200.00', '66.67', '200.00', '66.67']);
    expect(line(rows, 'Списания')).toEqual(['Списания', '300.00', '100.00', '300.00', '100.00']);
    expect(line(rows, 'Остаток на конец периода')).toEqual(['Остаток на конец периода', '700.00', '', '700.00', '']);
  });

  it('«Прибыль»: «Прибыль», «Доходы», «Расходы», имя файла; неверный период — 400 с полем', async () => {
    await october();
    const res = await download(`/api/v1/companies/${w.cid}/analytics/pnl.xlsx?${OCTOBER}`);
    expect(decodeURIComponent(String(res.headers['content-disposition']))).toContain('ТОО - Прибыль - 06-10-2026 17-00.xlsx');
    const { info, rows } = sheet(res.rawPayload);
    // складов у компании нет - закупки
    expect(info).toEqual(['Отчёт: Прибыль', 'Период: 01.10.2026 – 31.10.2026', 'Шаг: по неделям', 'Разрез: по категориям', 'Фильтры: нет', 'Склад: закупки']);
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

describe('Excel отчётов: сведения над таблицей, отрицательные суммы, скрытые остатки, склад (R13, R15)', () => {
  it('фильтры - названиями: счёт, категории, контрагент, проект, тег, «без …»; разрез и шаг - словами', async () => {
    await october();
    const client = (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'client', name: 'Клиент А' })).counterparty.id as number;
    const tag = (await w.post(`/api/v1/companies/${w.cid}/tags`, { name: 'Акция' })).tag.id as number;
    const qs = `from=2026-10-01&to=2026-10-31&by=project&step=quarter&accounts=${w.kzt}&categories=${w.income}&counterparties=${client}&projects=${w.project}&tags=${tag}&withoutProject=true&withoutCounterparty=true&withoutCategory=true`;
    const { info } = sheet((await download(`/api/v1/companies/${w.cid}/analytics/cashflow.xlsx?${qs}`)).rawPayload);
    expect(info.slice(0, 4)).toEqual(['Отчёт: Деньги', 'Период: 01.10.2026 – 31.10.2026', 'Шаг: по кварталам', 'Разрез: по проектам']);
    expect(info[4]).toMatch(/^Фильтры: Счета: .+; Категории: .+; Контрагенты: Клиент А; Проекты: .+; Теги: Акция; Без категории; Без контрагента; Без проекта$/);
    expect(info).toHaveLength(5);
  });

  it('отрицательные суммы - отрицательные числа в ячейках (чистый денежный поток, прибыль)', async () => {
    w = await opsWorld();
    await w.post(w.ops, { type: 'expense', paidAt: '2026-10-05T05:00:00Z', accountId: w.kzt, amount: 30_000, lines: [{ categoryId: w.expense, amount: 30_000 }] });
    const cash = sheet((await download(`/api/v1/companies/${w.cid}/analytics/cashflow.xlsx?from=2026-10-01&to=2026-10-31`)).rawPayload).rows;
    expect(line(cash, 'Чистый денежный поток').slice(1)).toEqual(['-300.00', '-300.00']);
    const profit = sheet((await download(`/api/v1/companies/${w.cid}/analytics/pnl.xlsx?from=2026-10-01&to=2026-10-31`)).rawPayload).rows;
    expect(line(profit, 'Прибыль').slice(1)).toEqual(['-300.00', '-300.00']);
  });

  it('остатки скрыты фильтром не по счетам: вместо остатков - строка «Остатки скрыты» с пустыми ячейками, а не нулями; строки сведений называют фильтр', async () => {
    await october();
    const { info, rows } = sheet((await download(`/api/v1/companies/${w.cid}/analytics/cashflow.xlsx?from=2026-10-01&to=2026-10-31&categories=${w.income}`)).rawPayload);
    expect(info[4]).toMatch(/^Фильтры: Категории: /);
    expect(line(rows, HIDDEN_BALANCES_TEXT).slice(1)).toEqual(['', '']);
    expect(rows.some((r) => r[0]!.startsWith('Остаток на'))).toBe(false);
    expect(line(rows, 'Поступления').slice(1)).toEqual(['1000.00', '1000.00']);
  });

  it('«Прибыль» со складом: строки склада с суммами, «Склад: по себестоимости» и предупреждение «Нет партии»; без склада - «закупки» и без строк склада', async () => {
    const sw = await stockWorld();
    w = sw;
    await sw.h.req('PATCH', `/api/v1/companies/${sw.cid}/accounts/${sw.kzt}`, { openedAt: '2026-01-01' });
    await sw.receipt('2026-10-01T06:00:00Z', [[sw.cola, 10_000, 100_000]]);
    await sw.sale('2026-10-02T06:00:00Z', [[sw.cola, 4000, 200_000]]);
    await sw.writeoff('2026-10-03T06:00:00Z', [[sw.cola, 1000]]);
    await sw.doc({ type: 'sale', at: '2026-10-04T06:00:00Z', warehouseId: sw.wh2, lines: [{ itemId: sw.cola, qty: 1000, amount: 50_000 }] });
    const url = (extra = '') => `/api/v1/companies/${sw.cid}/analytics/pnl.xlsx?from=2026-10-01&to=2026-10-31${extra}`;
    const on = sheet((await download(url())).rawPayload);
    expect(on.info.slice(5)).toEqual(['Склад: по себестоимости', 'У 1 продажи себестоимость не определена — прибыль завышена']);
    expect(line(on.rows, 'Себестоимость проданных товаров').slice(1)).toEqual(['400.00', '400.00']);
    expect(line(on.rows, 'Списания товаров').slice(1)).toEqual(['100.00', '100.00']);
    const off = sheet((await download(url('&stock=0'))).rawPayload);
    expect(off.info.slice(5)).toEqual(['Склад: закупки']);
    expect(off.rows.some((r) => r[0]!.trim() === 'Себестоимость проданных товаров')).toBe(false);
  });
});
