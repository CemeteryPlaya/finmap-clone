import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkImport, formatReport, isMatch } from '../../scripts/lib/import-check';
import { parseArgs, runImportCheck, USAGE } from '../../scripts/lib/import-check-cli';
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
    // «Касса», «Доходы: Бар» и число доходов: строка «Сейфа» в число файла не входит (счёта нет), в базе — лишняя операция
    expect(r.mismatches).toBe(3);
    expect(r.counts[0]).toEqual({ what: 'доходы', file: 2, db: 3, currency: null });
    expect(r.unchecked).toBe(1);
    expect(r.accounts[0]).toMatchObject({ what: 'Касса, KZT', db: r.accounts[0]!.file + 777 });
    expect(r.notes).toEqual(['Нет счёта в компании для: Сейф — их строки не сверялись']);
    const text = formatReport(r);
    expect(text.at(-1)).toBe('Итог: Расхождений: 3; не сверено: 1 — см. «Внимание»');
    expect(text.some((l) => l.startsWith('≠ Доходы: Бар'))).toBe(true);
  });

  it('ошибка файла — тем же текстом, что в панели; нет компании — понятная ошибка', async () => {
    w = await opsWorld();
    expect(() => checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: Buffer.from('%PDF-1.4'), ...CTX, fileName: 'отчёт.pdf' })).toThrow('Нужен файл .xlsx или .csv');
    expect(() => checkImport({ sqlite: w.h.t.sqlite, companyId: 999_999, data: finmapLikeXlsx(ROWS), ...CTX })).toThrow('Компании с id 999999 нет');
  });
});

describe('сверка импорта: что не сверено, не даёт «Совпадает» (ошибки, неизвестный счёт, кросс-валюта)', () => {
  it('строка с ошибкой разбора: расхождений нет, но итог не «Совпадает», isMatch — false', async () => {
    w = await opsWorld();
    await importFile();
    const bad = fr({ paidAt: at('2026-10-02', '10:00:00'), amount: null, to: 'Касса', category: 'Бар' });
    const r = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx([...ROWS, bad]), ...CTX });
    expect(r.rows.errors).toBe(1);
    expect(r.mismatches).toBe(0);
    expect(r.unchecked).toBe(1);
    expect(isMatch(r)).toBe(false);
    expect(r.notes).toEqual(['Строк с ошибками разбора: 1 — они не импортируются и не сверялись']);
    expect(formatReport(r).at(-1)).toBe('Итог: Не сверено: 1 — см. «Внимание»');
  });

  it('строки с неизвестным счётом не входят в число операций файла; перевод на неизвестный счёт — тоже', async () => {
    w = await opsWorld();
    await importFile();
    const extra = [
      fr({ paidAt: at('2026-10-01'), amount: 5, to: 'Сейф', category: 'Бар' }),
      fr({ paidAt: at('2026-10-01', '01:00:00'), amount: 7, from: 'Касса', to: 'Сейф' }),
    ];
    const r = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx([...ROWS, ...extra]), ...CTX });
    expect(r.counts.map((l) => [l.file, l.db])).toEqual([[2, 2], [2, 2], [1, 1]]);
    expect(r.accounts.map((l) => l.file === l.db)).toEqual([true, true]);
    expect(r.mismatches).toBe(0);
    expect(r.unchecked).toBe(2);
    expect(r.notes[0]).toBe('Нет счёта в компании для: Сейф — их строки не сверялись');
  });

  it('валютные счета: доход и перевод USD → KZT сверяются по «Сумме в валюте компании»; перевод KZT → USD без неё — не сверен', async () => {
    w = await opsWorld();
    const rows = [
      fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 10, baseAmount: 4751.2, to: 'Валютный', category: 'Бар' }),
      fr({ paidAt: at('2026-10-03', '10:00:00'), amount: 4, baseAmount: 1900.48, from: 'Валютный', to: 'Касса' }),
      fr({ paidAt: at('2026-10-04', '10:00:00'), amount: 3000, from: 'Касса', to: 'Валютный' }),
    ];
    await importFile(rows);
    const r = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx(rows), ...CTX });
    expect(r.counts.map((l) => [l.file, l.db])).toEqual([[1, 1], [0, 0], [2, 2]]);
    expect(r.accounts.find((l) => l.what === 'Валютный, USD')).toMatchObject({ currency: 'USD', file: 600 });
    expect(r.categories).toEqual([{ what: 'Доходы: Бар', file: 475_120, db: 475_120, currency: 'KZT' }]);
    expect(r.notes).toContain('Переводов между валютами без суммы в валюте компании: 1 — сумма зачисления не сверялась');
    // получатель такого перевода не сверяется — это не расхождение: итог «Не сверено», а не «Расхождений»
    expect(r.notes).toContain('Зачисления переводов между валютами на эти счета не сверялись (остальное движение сверено): Валютный');
    // движение без зачисления перевода: доход 10 USD в файле и в базе
    expect(r.accounts.find((l) => l.what === 'Валютный, USD')).toMatchObject({ file: 1000 - 400, db: 1000 - 400, unverified: true });
    expect(r.accounts.find((l) => l.what === 'Касса, KZT')?.unverified).toBeUndefined();
    expect(r.mismatches).toBe(0);
    expect(r.unchecked).toBe(1);
    expect(isMatch(r)).toBe(false);
    expect(formatReport(r).at(-1)).toBe('Итог: Не сверено: 1 — см. «Внимание»');
    expect(formatReport(r).some((l) => l.startsWith('? Валютный, USD'))).toBe(true);
  });

  const CROSS_ROWS = [
    fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 10, baseAmount: 4751.2, to: 'Валютный', category: 'Бар' }),
    fr({ paidAt: at('2026-10-04', '10:00:00'), amount: 3000, from: 'Касса', to: 'Валютный' }),
  ];

  it('настоящее расхождение на счёте-получателе перевода между валютами (удвоенный доход) — «Расхождений», а не «Не сверено»', async () => {
    w = await opsWorld();
    await importFile(CROSS_ROWS);
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-02T05:00:00Z', accountId: w.usd, amount: 1000, lines: [{ categoryId: w.income, projectId: null, amount: 1000 }] });
    const r = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx(CROSS_ROWS), ...CTX });
    expect(r.accounts.find((l) => l.what === 'Валютный, USD')).toMatchObject({ file: 1000, db: 2000, unverified: true });
    expect(r.mismatches).toBeGreaterThanOrEqual(1);
    expect(formatReport(r).some((l) => l.startsWith('≠ Валютный, USD'))).toBe(true);
    expect(formatReport(r).at(-1)).toMatch(/^Итог: Расхождений: \d+; не сверено: 1 — см\. «Внимание»$/);
  });

  it('настоящее расхождение на другом счёте при переводе между валютами по-прежнему считается', async () => {
    w = await opsWorld();
    await importFile(CROSS_ROWS);
    const before = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx(CROSS_ROWS), ...CTX });
    expect(before.mismatches).toBe(0);
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-02T05:00:00Z', accountId: w.kzt, amount: 777, lines: [{ categoryId: w.income, projectId: null, amount: 777 }] });
    const r = checkImport({ sqlite: w.h.t.sqlite, companyId: w.cid, data: finmapLikeXlsx(CROSS_ROWS), ...CTX });
    expect(r.accounts.find((l) => l.what === 'Касса, KZT')).toMatchObject({ db: r.accounts.find((l) => l.what === 'Касса, KZT')!.file + 777 });
    expect(r.accounts.find((l) => l.what === 'Валютный, USD')).toMatchObject({ file: 1000, db: 1000 });
    expect(r.mismatches).toBe(3);
    expect(formatReport(r).some((l) => l.startsWith('≠ Касса, KZT'))).toBe(true);
  });

  it('чтение базы — одна транзакция чтения, на соединении только на чтение: файл не меняется', async () => {
    w = await opsWorld();
    await importFile();
    const ro = new Database(path.join(w.h.t.dir, 'app.db'), { readonly: true, fileMustExist: true });
    try {
      const inTx: boolean[] = [];
      const prepare = ro.prepare.bind(ro);
      vi.spyOn(ro, 'prepare').mockImplementation(((sql: string) => {
        inTx.push(ro.inTransaction);
        return prepare(sql);
      }) as typeof ro.prepare);
      const r = checkImport({ sqlite: ro, companyId: w.cid, data: finmapLikeXlsx(ROWS), ...CTX });
      expect(r.mismatches).toBe(0);
      expect(isMatch(r)).toBe(true);
      expect(inTx.length).toBeGreaterThan(3);
      expect(inTx.every(Boolean)).toBe(true);
      expect(ro.inTransaction).toBe(false);
      expect(() => ro.exec('DELETE FROM operations')).toThrow(/readonly/i);
    } finally {
      ro.close();
    }
  });
});

describe('npm run import:check: разбор аргументов и коды выхода', () => {
  const cleanup: string[] = [];
  afterEach(() => {
    for (const d of cleanup.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  /** Файл во временной папке системы; сама папка убирается после теста. */
  function tmpFile(name: string, data: Buffer): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-check-'));
    cleanup.push(dir);
    const file = path.join(dir, name);
    fs.writeFileSync(file, data);
    return file;
  }

  function run(argv: string[], env: Record<string, string | undefined>, loadEnvFile: () => void = () => {}) {
    const out: string[] = [];
    const err: string[] = [];
    const code = runImportCheck(argv, { log: (l) => out.push(l), error: (l) => err.push(l), env, loadEnvFile });
    return { code, out: out.join('\n'), err: err.join('\n') };
  }

  const envOf = (dir: string) => ({ SESSION_SECRET: 's'.repeat(40), DATA_DIR: dir });

  it('parseArgs: файл и id компании, --today в любом месте; лишнее, нуль, не число, плохая дата — ошибка', () => {
    expect(parseArgs(['ф.xlsx', '5'])).toEqual({ file: 'ф.xlsx', companyId: 5, today: undefined });
    expect(parseArgs(['ф.xlsx', '5', '--today', '2026-10-06'])).toEqual({ file: 'ф.xlsx', companyId: 5, today: '2026-10-06' });
    expect(parseArgs(['--today', '2026-10-06', 'ф.xlsx', '5'])).toEqual({ file: 'ф.xlsx', companyId: 5, today: '2026-10-06' });
    for (const bad of [[], ['ф.xlsx'], ['ф.xlsx', '0'], ['ф.xlsx', 'abc'], ['ф.xlsx', '-3'], ['ф.xlsx', '1.5'], ['ф.xlsx', '5', 'лишнее']]) {
      expect(parseArgs(bad), JSON.stringify(bad)).toEqual({ error: USAGE });
    }
    expect(parseArgs(['ф.xlsx', '5', '--today'])).toEqual({ error: 'Неверная дата --today: (нет) — нужна ГГГГ-ММ-ДД' });
    expect(parseArgs(['ф.xlsx', '5', '--today', '2026-02-30'])).toEqual({ error: 'Неверная дата --today: 2026-02-30 — нужна ГГГГ-ММ-ДД' });
    expect(parseArgs(['ф.xlsx', '5', '--today', 'вчера'])).toEqual({ error: 'Неверная дата --today: вчера — нужна ГГГГ-ММ-ДД' });
  });

  it('код 0 и «Итог: Совпадает» при полном совпадении; --today учитывается', async () => {
    w = await opsWorld();
    await importFile();
    const file = tmpFile('выгрузка.xlsx', finmapLikeXlsx(ROWS));
    const ok = run([file, String(w.cid), '--today', '2026-10-06'], envOf(w.h.t.dir));
    expect(ok.err).toBe('');
    expect(ok.out).toContain('Итог: Совпадает');
    expect(ok.code).toBe(0);
    // позже декабрьская строка — уже не плановая: расхождение
    const later = run([file, String(w.cid), '--today', '2026-12-31'], envOf(w.h.t.dir));
    expect(later.out).toContain('Итог: Расхождений:');
    expect(later.code).toBe(1);
  });

  it('код 1: несверенные строки, ошибки аргументов, файла, базы, настроек; ошибка файла — текстом панели', async () => {
    w = await opsWorld();
    await importFile();
    const env = envOf(w.h.t.dir);
    const good = tmpFile('выгрузка.xlsx', finmapLikeXlsx(ROWS));
    const cid = String(w.cid);
    const withBad = tmpFile('с-ошибкой.xlsx', finmapLikeXlsx([...ROWS, fr({ paidAt: at('2026-10-02'), amount: null, to: 'Касса' })]));
    const unchecked = run([withBad, cid, '--today', '2026-10-06'], env);
    expect(unchecked.out).toContain('Итог: Не сверено: 1');
    expect(unchecked.code).toBe(1);
    expect(run([good], env)).toMatchObject({ code: 1, err: USAGE });
    expect(run([good, cid, '--today', 'вчера'], env)).toMatchObject({ code: 1, err: 'Неверная дата --today: вчера — нужна ГГГГ-ММ-ДД' });
    expect(run([path.join(os.tmpdir(), 'нет-такого-файла.xlsx'), cid], env).err).toContain('Файл не найден:');
    expect(run([tmpFile('отчёт.pdf', Buffer.from('%PDF-1.4')), cid], env)).toMatchObject({ code: 1, err: expect.stringContaining('Нужен файл .xlsx или .csv') });
    expect(run([good, '999999'], env)).toMatchObject({ code: 1, err: 'Сверка не удалась: Компании с id 999999 нет' });
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-check-empty-'));
    cleanup.push(empty);
    expect(run([good, cid], envOf(empty)).err).toContain('База не найдена:');
    // настройки не заданы: ошибка конфигурации — кодом 1, а не падением
    const noSecret = run([good, cid], { DATA_DIR: w.h.t.dir });
    expect(noSecret.code).toBe(1);
    expect(noSecret.err).toContain('Сверка не удалась: Ошибка конфигурации');
    // файл настроек, который не читается, — тоже код 1 (loadEnvFile внутри try)
    const broken = run([good, cid], env, () => {
      throw new Error('файл настроек недоступен');
    });
    expect(broken).toMatchObject({ code: 1, err: 'Сверка не удалась: файл настроек недоступен' });
  });
});
