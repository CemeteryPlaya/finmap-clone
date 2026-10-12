import { afterEach, describe, expect, it } from 'vitest';
import { createAuditService } from '../../src/server/modules/audit/service';
import { parseSheet } from '../../src/server/modules/imports/parse-row';
import { buildPreview, minuteOf } from '../../src/server/modules/imports/preview';
import { readXlsx } from '../../src/server/modules/imports/xlsx-read';
import { createRatesService } from '../../src/server/modules/rates/service';
import { ACCOUNT_NAME_MAX } from '../../src/shared/schemas/accounts';
import type { AccountMapping } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeRow as fr, finmapLikeXlsx, type FinmapLikeValue } from '../helpers/finmap-like';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const NOW = new Date('2026-10-06T12:00:00.000Z'); // 17:00 по Алматы
const CTX = { timezone: 'Asia/Almaty', baseCurrency: 'KZT', today: '2026-10-06' };

/** Предпросмотр синтетического файла в компании opsWorld (счета «Касса» KZT и «Валютный» USD, курс USD 475.12 на 01.10.2026). */
function preview(rows: FinmapLikeValue[][], mappings: AccountMapping[] = [], sha256 = 'sha-1') {
  const db = w.h.t.db;
  const parsed = parseSheet(readXlsx(finmapLikeXlsx(rows)), CTX);
  return buildPreview(
    { db, rates: createRatesService({ db, audit: createAuditService(db) }), timezone: 'Asia/Almaty', now: () => NOW },
    { token: 'тест', companyId: w.cid, file: { name: 'выгрузка.xlsx', size: 123, sha256 }, parsed },
    mappings,
  );
}
const one = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).get(...args) as Record<string, number>;
const systemId = (key: string) => one('SELECT id FROM categories WHERE company_id = ? AND system_key = ?', w.cid, key).id!;

describe('предпросмотр: счета, движение, остатки (§5.4 спецификации импорта)', () => {
  it('сопоставление по умолчанию, движение, дата открытия, оба режима остатка и «Остаток после импорта»', async () => {
    w = await opsWorld();
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T05:00:00Z', accountId: w.kzt, amount: 20000 }); // остаток «Кассы» 200 ₸
    const rows = [
      fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 10000, to: 'КАССА' }),
      fr({ paidAt: at('2026-09-20', '09:00:00'), amount: 2500, from: 'Касса' }),
      fr({ paidAt: at('2026-10-03', '12:00:00'), amount: 5000, to: 'Банк-2' }),
      fr({ paidAt: at('2026-10-04', '08:30:00'), amount: 1000, from: 'Банк-2', to: '\u004Bасса' }), // латинская K
    ];
    const { preview: p, plan } = preview(rows);
    expect(p.counts).toEqual({ income: 2, expense: 1, transfer: 1, add: 4, duplicates: 0, skippedFuture: 0 });
    expect(p.period).toEqual({ from: '2026-09-20', to: '2026-10-04' });
    expect(p.accounts).toEqual([
      {
        key: 'касса',
        fileName: 'КАССА',
        rows: 3,
        mapping: { key: 'касса', kind: 'existing', accountId: w.kzt },
        currency: 'KZT',
        movement: 1_000_000 - 250_000 + 100_000,
        existing: { balance: 20000, openedAt: '2026-10-01', newOpenedAt: '2026-09-20' },
        archivedHint: false,
        errors: [],
      },
      {
        key: 'банк-2',
        fileName: 'Банк-2',
        rows: 2,
        mapping: { key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: null },
        currency: 'KZT',
        movement: 500_000 - 100_000,
        archivedHint: false,
        errors: [],
      },
    ]);
    expect(p.canImport).toBe(true);
    expect(plan.accounts).toEqual([{ key: 'банк-2', name: 'Банк-2', currency: 'KZT', startingBalance: 0, openedAt: '2026-10-03' }]);
    expect(plan.accountChanges).toEqual([{ accountId: w.kzt, before: { startingBalance: 0, openedAt: '2026-10-01' }, after: { startingBalance: 0, openedAt: '2026-09-20' } }]);
    // план: по времени, суммы в минимальных единицах, счета — id или ключ нового
    expect(plan.rows.map((r) => [r.row, r.type, r.account, r.toAccount, r.amount, r.toAmount, r.baseAmount, r.rate])).toEqual([
      [3, 'expense', { id: w.kzt }, null, 250_000, null, 250_000, '1'],
      [2, 'income', { id: w.kzt }, null, 1_000_000, null, 1_000_000, '1'],
      [4, 'income', { key: 'банк-2' }, null, 500_000, null, 500_000, '1'],
      [5, 'transfer', { key: 'банк-2' }, { id: w.kzt }, 100_000, 100_000, 100_000, '1'],
    ]);

    const modes = preview(rows, [
      { key: 'банк-2', kind: 'new', name: ' Банк  2 ', currency: 'USD', balance: { mode: 'current', amount: 1_000_000 } },
      { key: 'касса', kind: 'existing', accountId: w.kzt, targetBalance: 900_000 },
    ]);
    // новый счёт в USD: суммы — по курсу; «Текущий остаток» B → стартовый B - движение
    expect(modes.plan.accounts).toEqual([{ key: 'банк-2', name: 'Банк 2', currency: 'USD', startingBalance: 1_000_000 - 400_000, openedAt: '2026-10-03' }]);
    // перевод USD → KZT: сумма зачисления — в базовой валюте
    expect(modes.plan.rows.find((r) => r.type === 'transfer')).toMatchObject({ amount: 100_000, baseAmount: 47_512_000, toAmount: 47_512_000, rate: '475.12' });
    // «Остаток после импорта» 9 000 ₸: стартовый = цель - (движение имеющихся операций + движение файла)
    expect(modes.plan.accountChanges).toEqual([
      { accountId: w.kzt, before: { startingBalance: 0, openedAt: '2026-10-01' }, after: { startingBalance: 900_000 - (20_000 + 1_000_000 - 250_000 + 47_512_000), openedAt: '2026-09-20' } },
    ]);
    const start = preview(rows, [{ key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'start', amount: 50_000 } }]);
    expect(start.plan.accounts[0]!.startingBalance).toBe(50_000);
  });

  it('ошибки счетов: несколько подходящих (A1), выбран несуществующий (A1) или архивный (A5), название (A3), валюта (A2), остаток (A4)', async () => {
    w = await opsWorld();
    await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'касса', currency: 'KZT', openedAt: '2026-10-01' });
    const safe = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id as number;
    await w.post(`/api/v1/companies/${w.cid}/accounts/${safe}/archive`, {});
    const rows = [
      fr({ paidAt: at('2026-10-02'), amount: 100, to: 'Касса' }),
      fr({ paidAt: at('2026-10-02'), amount: 100, to: 'Сейф' }),
      fr({ paidAt: at('2026-10-02'), amount: 100, to: 'Банк' }),
    ];
    const a = preview(rows);
    expect(a.preview.accounts.map((x) => [x.key, x.mapping?.kind ?? null, x.archivedHint, x.errors])).toEqual([
      ['касса', null, false, [{ code: 'A1', message: 'Выберите счёт для «Касса» — подходит несколько' }]],
      ['сейф', 'new', true, []],
      ['банк', 'new', false, []],
    ]);
    expect(a.preview.counts.add).toBe(2); // строки счёта без выбора не считаются
    expect(a.preview.canImport).toBe(false);

    const b = preview(rows, [
      { key: 'касса', kind: 'existing', accountId: 999_999 },
      { key: 'сейф', kind: 'existing', accountId: safe },
      { key: 'банк', kind: 'new', name: '\u200B', currency: 'EUR', balance: null },
    ]);
    expect(b.preview.accounts.map((x) => x.errors.map((e) => `${e.code}: ${e.message}`))).toEqual([
      ['A1: Выберите счёт для «Касса»'],
      ['A5: Счёт «Сейф» в архиве — выберите другой'],
      ['A3: Название счёта: от 1 до 120 символов', 'A2: Неизвестная валюта'],
    ]);
    const c = preview(rows, [
      { key: 'касса', kind: 'existing', accountId: w.kzt, targetBalance: -Number.MAX_SAFE_INTEGER },
      { key: 'банк', kind: 'new', name: 'Банк', currency: 'KZT', balance: { mode: 'current', amount: -Number.MAX_SAFE_INTEGER } },
    ]);
    expect(c.preview.accounts.map((x) => x.errors.map((e) => e.code))).toEqual([['A4'], [], ['A4']]);
    // A4 у существующего и у нового счёта: их строки не считаются (решение 18, R1) — остаётся только строка «Сейфа»
    expect(c.preview.counts.add).toBe(1);
    expect(c.plan.rows.map((r) => r.row)).toEqual([3]);
    expect(c.plan.accountChanges).toEqual([]);
    expect(c.preview.canImport).toBe(false);
  });
});

describe('предпросмотр: суммы и валюты (§4.2)', () => {
  it('счёт USD без F — курс на дату; с F — F и производный курс; нет курса — R16; перевод KZT → USD; W9 и W10; хвосты float', async () => {
    w = await opsWorld();
    const { preview: p, plan } = preview([
      fr({ paidAt: at('2026-10-05', '10:00:00'), amount: 1, from: 'Валютный' }),
      fr({ paidAt: at('2026-10-05', '11:00:00'), amount: 1, baseAmount: 480, from: 'Валютный' }),
      fr({ paidAt: at('2026-10-05', '12:00:00'), amount: 475.12, from: 'Касса', to: 'Валютный' }),
      fr({ paidAt: at('2026-10-05', '13:00:00'), amount: 100, baseAmount: 101, from: 'Касса' }),
      fr({ paidAt: at('2026-10-05', '14:00:00'), amount: '1,005', from: 'Касса' }),
      fr({ paidAt: at('2026-09-01', '10:00:00'), amount: 1, from: 'Валютный' }),
      // хвост двоичной дроби Excel — не «лишние знаки»: ни округления, ни W10 (Review Focus 3)
      fr({ paidAt: at('2026-10-05', '15:00:00'), amount: 1317.0000000000002, baseAmount: 1317.0000000000002, from: 'Касса' }),
    ]);
    expect(plan.rows.map((r) => [r.row, r.amount, r.baseAmount, r.rate, r.toAmount])).toEqual([
      [2, 100, 47512, '475.12', null],
      [3, 100, 48000, '480', null],
      [4, 47512, 47512, '1', 100],
      [5, 10000, 10000, '1', null],
      [6, 101, 101, '1', null],
      [8, 131700, 131700, '1', null],
    ]);
    expect(p.errors).toEqual({
      total: 1,
      byCode: [{ code: 'R16', message: 'Нет курса USD на 01.09.2026 — заполните «Сумму в валюте компании» или добавьте курс на дату', count: 1, rows: [7] }],
    });
    expect(p.warnings.map((g) => [g.code, g.rows])).toEqual([
      ['W9', [5]],
      ['W10', [6]],
    ]);
    expect(p.canImport).toBe(false);
  });
});

describe('предпросмотр: дубликаты (§5.5)', () => {
  it('ключ с категорией и контрагентом («22:07»), кратность, разбитая операция, перевод; удалённые не считаются; новые счета — не дубликаты', async () => {
    w = await opsWorld();
    const salary = systemId('salary');
    const cp = async (name: string) => (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'employee', name })).counterparty.id as number;
    const a = await cp('Сотрудник А');
    const b = await cp('Сотрудник Б');
    const bank = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Банк', currency: 'KZT', openedAt: '2026-10-01' })).account.id as number;
    // два расхода по 85 ₸ с «Кассы» по «Зарплате» в 22:07 — разным сотрудникам
    for (const counterpartyId of [a, b]) {
      await w.post(w.ops, { type: 'expense', paidAt: '2026-10-03T17:07:00Z', accountId: w.kzt, amount: 8500, counterpartyId, lines: [{ categoryId: salary, amount: 8500 }] });
    }
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-04T05:00:00Z', accountId: w.kzt, amount: 30000, lines: [{ categoryId: w.income, amount: 20000 }, { categoryId: w.income, amount: 10000 }] });
    const gone = (await w.post(w.ops, { type: 'expense', paidAt: '2026-10-04T06:00:00Z', accountId: w.kzt, amount: 777 })).operation.id as number;
    expect((await w.h.req('DELETE', `${w.ops}/${gone}`)).statusCode).toBe(200);
    await w.post(w.ops, { type: 'transfer', paidAt: '2026-10-04T07:00:00Z', accountId: w.kzt, amount: 1000, toAccountId: bank });

    const { preview: p } = preview([
      fr({ paidAt: at('2026-10-03', '22:07:30'), amount: 85, from: 'Касса', category: 'Зарплата', counterparty: 'Сотрудник А' }),
      fr({ paidAt: at('2026-10-03', '22:07:00'), amount: 85, from: 'Касса', category: 'Зарплата', counterparty: 'Сотрудник Б' }),
      fr({ paidAt: at('2026-10-03', '22:07:00'), amount: 85, from: 'Касса', category: 'Зарплата', counterparty: 'Сотрудник А' }),
      fr({ paidAt: at('2026-10-04', '10:00:00'), amount: 200, to: 'Касса', category: 'Бар' }),
      fr({ paidAt: at('2026-10-04', '10:00:00'), amount: 100, to: 'Касса', category: 'Бар' }),
      fr({ paidAt: at('2026-10-04', '11:00:00'), amount: 7.77, from: 'Касса' }),
      fr({ paidAt: at('2026-10-04', '12:00:00'), amount: 10, from: 'Касса', to: 'Банк' }),
      fr({ paidAt: at('2026-10-04', '12:00:00'), amount: 10, from: 'Касса', to: 'Новый банк' }),
    ]);
    expect(p.duplicates).toEqual({ count: 5, rows: [2, 3, 5, 6, 8] });
    expect(p.counts).toMatchObject({ add: 3, duplicates: 5 });
    expect(p.canImport).toBe(true);
    expect(minuteOf('2026-10-03T17:07:59.000Z', 'Asia/Almaty')).toBe('2026-10-03 22:07');
  });

  it('повторный файл: все строки — дубликаты, «Нечего импортировать»; W8 — только у неотменённого импорта с тем же SHA-256', async () => {
    w = await opsWorld();
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T05:00:00Z', accountId: w.kzt, amount: 10000 });
    const rows = [fr({ paidAt: at('2026-10-05', '10:00:00'), amount: 100, to: 'Касса' })];
    const ins = w.h.t.sqlite.prepare(
      "INSERT INTO imports (company_id, user_id, file_name, file_size, file_sha256, status, counts, created, account_changes, created_at) VALUES (?, 1, 'f', 1, ?, ?, '{}', '{}', '[]', '2026-10-06T12:00:00.000Z')",
    );
    ins.run(w.cid, 'sha-old', 'undone');
    expect(preview(rows, [], 'sha-old').preview.warnings).toEqual([]);
    ins.run(w.cid, 'sha-old', 'done');
    const { preview: p } = preview(rows, [], 'sha-old');
    expect(p.counts).toMatchObject({ add: 0, duplicates: 1 });
    expect(p.canImport).toBe(false);
    expect(p.warnings).toEqual([
      { code: 'W8', message: 'Этот файл уже импортирован 06.10.2026, 17:00 (Тест) — совпадение по SHA-256, импорт не отменён', count: 1, rows: [] },
    ]);
  });
});

describe('предпросмотр: «Будет создано», ошибки строк (§5.3)', () => {
  it('новые категории с родителем, контрагенты с типом, проекты, теги; ошибки строк блокируют импорт', async () => {
    w = await opsWorld();
    const { preview: p } = preview([
      fr({ paidAt: at('2026-10-05'), amount: 100, from: 'Касса', category: 'Зарплата', subcategory: 'Бармены', counterparty: 'Сотрудник В', project: 'Клуб 3', tags: 'Смена, Ночь' }),
      fr({ paidAt: at('2026-10-05'), amount: 100, to: 'Касса', category: 'Кухня', counterparty: 'Гость' }),
      fr({ paidAt: at('2026-10-05'), amount: 'сто', to: 'Касса' }),
    ]);
    expect(p.create).toEqual({
      categories: {
        total: 2,
        items: [
          { name: 'Кухня', kind: 'income', rows: 1 },
          { name: 'Бармены', kind: 'expense', parent: 'Зарплата', rows: 1 },
        ],
      },
      counterparties: {
        total: 2,
        items: [
          { name: 'Сотрудник В', type: 'employee', rows: 1 },
          { name: 'Гость', type: 'client', rows: 1 },
        ],
      },
      projects: { total: 1, items: [{ name: 'Клуб 3', rows: 1 }] },
      tags: { total: 1, items: [{ name: 'Ночь', rows: 1 }] },
    });
    expect(p.errors).toEqual({ total: 1, byCode: [{ code: 'R05', message: 'Не удалось прочитать сумму «сто»', count: 1, rows: [4] }] });
    expect(p.file).toEqual({ name: 'выгрузка.xlsx', size: 123, rows: 3 });
    expect(p.canImport).toBe(false);
  });
});

describe('предпросмотр: правки по ревью', () => {
  it('два названия из файла — один существующий счёт: дата открытия по самой ранней строке любого названия; разные «Остатки после импорта» — ошибка', async () => {
    w = await opsWorld();
    const rows = [
      fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 100, to: 'Касса' }),
      fr({ paidAt: at('2026-09-10', '10:00:00'), amount: 50, from: 'Касса клуба' }),
    ];
    const both = (target2: number | null) =>
      preview(rows, [
        { key: 'касса', kind: 'existing', accountId: w.kzt, targetBalance: 100_000 },
        { key: 'касса клуба', kind: 'existing', accountId: w.kzt, targetBalance: target2 },
      ]);
    const one = both(null);
    expect(one.preview.accounts.map((a) => [a.key, a.existing?.newOpenedAt, a.errors])).toEqual([
      ['касса', '2026-09-10', []],
      ['касса клуба', '2026-09-10', []],
    ]);
    // стартовый = цель - (движение имеющихся 0 + движение файла по обоим названиям: +10 000 - 5 000)
    expect(one.plan.accountChanges).toEqual([
      { accountId: w.kzt, before: { startingBalance: 0, openedAt: '2026-10-01' }, after: { startingBalance: 100_000 - 5_000, openedAt: '2026-09-10' } },
    ]);
    expect(one.plan.rows.every((r) => r.paidAt >= '2026-09-09T19:00:00.000Z')).toBe(true);
    expect(one.preview.canImport).toBe(true);
    expect(both(100_000).preview.canImport).toBe(true);

    const conflict = both(200_000);
    expect(conflict.preview.accounts.map((a) => a.errors.map((e) => e.code))).toEqual([['A4'], ['A4']]);
    expect(conflict.preview.accounts[0]!.errors[0]!.message).toBe('Этот счёт выбран для нескольких названий с разными «Остатками после импорта» — оставьте одно значение');
    expect(conflict.plan.accountChanges).toEqual([]);
    // R1 (решение 18): строки счёта с A4 не входят ни в «будет добавлено», ни в период, ни в план
    expect(conflict.preview.counts.add).toBe(0);
    expect(conflict.preview.period).toBeNull();
    expect(conflict.plan.rows).toEqual([]);
    expect(conflict.preview.canImport).toBe(false);
  });

  it('новый счёт только с ошибкой названия (A3): его строки не считаются ни в «будет добавлено», ни в периоде, ни в движении', async () => {
    w = await opsWorld();
    const { preview: p, plan } = preview(
      [fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 100, to: 'Касса' }), fr({ paidAt: at('2026-09-01', '10:00:00'), amount: 70, to: 'Банк' })],
      [{ key: 'банк', kind: 'new', name: '   ', currency: 'KZT', balance: null }],
    );
    expect(p.accounts[1]).toMatchObject({ key: 'банк', currency: 'KZT', rows: 0, movement: 0, errors: [{ code: 'A3' }] });
    expect(p.counts.add).toBe(1);
    expect(p.period).toEqual({ from: '2026-10-02', to: '2026-10-02' });
    expect(plan.rows.map((r) => r.row)).toEqual([2]);
    expect(plan.accounts).toEqual([]);
    expect(p.canImport).toBe(false);
  });

  it('дата до 01.03.2024 (Алматы — UTC+6): момент и ключ дубликата по часам того времени', async () => {
    w = await opsWorld();
    const old = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Старая касса', currency: 'KZT', openedAt: '2024-01-01' })).account.id as number;
    await w.post(w.ops, { type: 'expense', paidAt: '2024-02-29T17:30:00Z', accountId: old, amount: 1000 }); // 23:30 по UTC+6
    await w.post(w.ops, { type: 'expense', paidAt: '2024-02-29T19:30:00Z', accountId: old, amount: 2000 }); // 00:30 01.03, уже UTC+5
    const { preview: p, plan } = preview([
      fr({ paidAt: at('2024-02-29', '23:30:00'), amount: 10, from: 'Старая касса' }),
      fr({ paidAt: at('2024-03-01', '00:30:00'), amount: 20, from: 'Старая касса' }),
      fr({ paidAt: at('2024-02-29', '22:30:00'), amount: 10, from: 'Старая касса' }),
    ]);
    expect(p.duplicates).toEqual({ count: 2, rows: [2, 3] });
    expect(plan.rows.map((r) => r.paidAt)).toEqual(['2024-02-29T16:30:00.000Z']);
    expect(minuteOf('2024-02-29T17:30:00.000Z', 'Asia/Almaty')).toBe('2024-02-29 23:30');
  });
});

describe('предпросмотр: перенесено из ревью задачи 4 (решение 5, §4.2, §4.4, §4.9)', () => {
  it('сумма E: не безопасное целое — R07 (и после пересчёта по курсу), округлилась до нуля — R06 без W10, лишние знаки — W10', async () => {
    w = await opsWorld();
    const { preview: p, plan } = preview([
      fr({ paidAt: at('2026-10-05', '09:00:00'), amount: '90071992547409,92', from: 'Касса' }),
      fr({ paidAt: at('2026-10-05', '10:00:00'), amount: '90071992547409,91', to: 'Касса' }), // ровно MAX_SAFE_INTEGER — можно
      fr({ paidAt: at('2026-10-05', '11:00:00'), amount: '0,001', from: 'Касса' }),
      fr({ paidAt: at('2026-10-05', '12:00:00'), amount: '0,005', from: 'Касса' }),
      fr({ paidAt: at('2026-10-05', '13:00:00'), amount: 10_000_000_000_000, from: 'Валютный' }), // × 475.12 — больше MAX_SAFE_INTEGER
    ]);
    expect(plan.rows.map((r) => [r.row, r.amount, r.baseAmount])).toEqual([
      [3, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      [5, 1, 1],
    ]);
    expect(p.errors).toEqual({
      total: 3,
      byCode: [
        { code: 'R07', message: 'Слишком большая сумма', count: 2, rows: [2, 6] },
        { code: 'R06', message: 'Сумма равна нулю', count: 1, rows: [4] },
      ],
    });
    expect(p.warnings).toEqual([{ code: 'W10', message: 'Больше 2 знаков после запятой — сумма округлена', count: 1, rows: [5] }]);
    // строки «Кассы» 05.10, счёт открыт 01.10: дата открытия только переносится раньше, никогда не позже
    expect(plan.accountChanges).toEqual([]);
    expect(p.canImport).toBe(false);
  });

  it('валюта нового счёта меняет округление E: KWD — три знака без W10, KZT — W10; F ≠ E у счёта в валюте компании — W9', async () => {
    w = await opsWorld();
    // в тестовой базе только KZT и USD; KWD — три знака после запятой
    w.h.t.sqlite.prepare("INSERT INTO currencies (code, name, symbol, minor_units) VALUES ('KWD', 'Кувейтский динар', 'KD', 3)").run();
    const rows = [fr({ paidAt: at('2026-10-05', '10:00:00'), amount: '1,001', baseAmount: 1000, to: 'Динар' })];
    const kwd = preview(rows, [{ key: 'динар', kind: 'new', name: 'Динар', currency: 'KWD', balance: null }]);
    expect(kwd.plan.rows.map((r) => [r.amount, r.baseAmount, r.rate])).toEqual([[1001, 100_000, '999.000999']]);
    expect(kwd.preview.warnings).toEqual([]);
    expect(kwd.preview.canImport).toBe(true);

    const kzt = preview(rows);
    expect(kzt.plan.rows.map((r) => [r.amount, r.baseAmount, r.rate])).toEqual([[100, 100, '1']]);
    expect(kzt.preview.warnings.map((g) => [g.code, g.rows])).toEqual([
      ['W10', [2]],
      ['W9', [2]],
    ]);
    expect(kzt.preview.canImport).toBe(true);
  });

  it('название нового счёта — repairName первого появления: двойники в кириллическом слове исправлены, латинское слово не тронуто', async () => {
    w = await opsWorld();
    const { preview: p, plan } = preview([
      fr({ paidAt: at('2026-10-05', '10:00:00'), amount: 10, to: '\u0411\u0061\u043D\u043A Kaspi' }), // «Б\u0061нк»: латинская a
      fr({ paidAt: at('2026-10-05', '11:00:00'), amount: 5, from: 'БАНК KASPI' }),
    ]);
    expect(p.accounts).toHaveLength(1);
    expect(p.accounts[0]).toMatchObject({
      fileName: '\u0411\u0061\u043D\u043A Kaspi',
      rows: 2,
      movement: 500,
      mapping: { kind: 'new', name: '\u0411\u0430\u043D\u043A Kaspi', currency: 'KZT', balance: null },
      errors: [],
    });
    expect(plan.accounts).toEqual([{ key: p.accounts[0]!.key, name: '\u0411\u0430\u043D\u043A Kaspi', currency: 'KZT', startingBalance: 0, openedAt: '2026-10-05' }]);
  });
});

describe('предпросмотр: правки по ревью задачи 6', () => {
  it('название счёта длиннее 120 символов: в карточке обрезано с «…», ошибка A3 остаётся и после отправки обрезанного названия обратно', async () => {
    w = await opsWorld();
    const long = `Счёт ${'я'.repeat(200)}`;
    const emoji = `${'я'.repeat(ACCOUNT_NAME_MAX - 1)}${String.fromCodePoint(0x1f600)}хвост`; // суррогатная пара на границе
    const rows = [fr({ paidAt: at('2026-10-05', '10:00:00'), amount: 10, to: long }), fr({ paidAt: at('2026-10-05', '11:00:00'), amount: 10, to: emoji })];
    const { preview: p } = preview(rows);
    const clipped = `${long.slice(0, ACCOUNT_NAME_MAX)}…`;
    expect(p.accounts[0]).toMatchObject({ fileName: clipped, mapping: { kind: 'new', name: clipped }, errors: [{ code: 'A3' }] });
    // пара не разрезана: 119 букв, эмодзи целиком и «…»
    expect(p.accounts[1]!.fileName).toBe(`${emoji.slice(0, ACCOUNT_NAME_MAX + 1)}…`);
    expect(p.accounts[1]!.fileName.length).toBe(ACCOUNT_NAME_MAX + 2);
    expect(p.counts.add).toBe(0);

    const again = preview(rows, [p.accounts[0]!.mapping!]);
    expect(again.preview.accounts[0]!.errors.map((e) => e.code)).toEqual(['A3']);
    expect(again.preview.canImport).toBe(false);
  });

  it('сумма зачисления перевода после пересчёта по курсу — ноль: R06 (0,01 ₸ → USD; 0,01 сум → ₸ без F), а не R07', async () => {
    w = await opsWorld();
    w.h.t.sqlite.prepare("INSERT INTO currencies (code, name, symbol, minor_units) VALUES ('UZS', 'Узбекский сум', 'сўм', 2)").run();
    await w.post('/api/v1/rates/manual', { date: '2026-10-01', currency: 'UZS', rate: '0.04' });
    const sum = { key: 'сумовой', kind: 'new', name: 'Сумовой', currency: 'UZS', balance: null } as const;
    const { preview: p, plan } = preview(
      [
        fr({ paidAt: at('2026-10-05', '10:00:00'), amount: '0,01', from: 'Касса', to: 'Валютный' }),
        fr({ paidAt: at('2026-10-05', '11:00:00'), amount: '0,01', from: 'Сумовой', to: 'Касса' }),
        fr({ paidAt: at('2026-10-05', '12:00:00'), amount: 100, from: 'Сумовой', to: 'Касса' }),
      ],
      [sum],
    );
    const R06_TO = 'Сумма зачисления после пересчёта по курсу равна нулю — заполните «Сумму в валюте компании»';
    expect(p.errors).toEqual({ total: 2, byCode: [{ code: 'R06', message: R06_TO, count: 2, rows: [2, 3] }] });
    // 100 сум × 0,04 = 4 ₸ — пересчёт не нулевой
    expect(plan.rows.map((r) => [r.row, r.amount, r.baseAmount, r.toAmount, r.rate])).toEqual([[4, 10_000, 400, 400, '0.04']]);
    expect(p.canImport).toBe(false);
  });

  it('огромные суммы: движение и остаток после импорта вне безопасного целого — A4 у существующего счёта без цели и у нового в обоих режимах', async () => {
    w = await opsWorld();
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T05:00:00Z', accountId: w.kzt, amount: 20000 }); // остаток «Кассы» 200 ₸
    const MAX = '90071992547409,91'; // Number.MAX_SAFE_INTEGER тиын
    const { preview: p, plan } = preview(
      [
        // «Касса»: движение = MAX, но с имеющимися 200 ₸ остаток больше MAX
        fr({ paidAt: at('2026-10-05', '10:00:00'), amount: MAX, to: 'Касса' }),
        // «Банк» (новый, без остатка): движение MAX + 100 тиын
        fr({ paidAt: at('2026-10-05', '10:00:00'), amount: MAX, to: 'Банк' }),
        fr({ paidAt: at('2026-10-05', '11:00:00'), amount: 1, to: 'Банк' }),
        // «Сейф» (новый, «Стартовый баланс» MAX): остаток MAX + 100 тиын
        fr({ paidAt: at('2026-10-05', '10:00:00'), amount: 1, to: 'Сейф' }),
        fr({ paidAt: at('2026-10-05', '10:00:00'), amount: 10, to: 'Резерв' }),
        // «Валютный»: движение файла 2 × MAX — одна ошибка A4, не две
        fr({ paidAt: at('2026-10-05', '10:00:00'), amount: MAX, baseAmount: 1, to: 'Валютный' }),
        fr({ paidAt: at('2026-10-05', '11:00:00'), amount: MAX, baseAmount: 1, to: 'Валютный' }),
      ],
      [{ key: 'сейф', kind: 'new', name: 'Сейф', currency: 'KZT', balance: { mode: 'start', amount: Number.MAX_SAFE_INTEGER } }],
    );
    const A4 = { code: 'A4', message: 'Слишком большие суммы: остаток счёта после импорта вне допустимого диапазона' };
    expect(p.accounts.map((a) => [a.key, a.errors])).toEqual([
      ['касса', [A4]],
      ['банк', [A4]],
      ['сейф', [A4]],
      ['резерв', []],
      ['валютный', [A4]],
    ]);
    expect(p.counts.add).toBe(1);
    expect(plan.rows.map((r) => r.row)).toEqual([6]);
    expect(plan.accounts).toEqual([{ key: 'резерв', name: 'Резерв', currency: 'KZT', startingBalance: 0, openedAt: '2026-10-05' }]);
    expect(plan.accountChanges).toEqual([]);
    expect(p.canImport).toBe(false);
  });
});
