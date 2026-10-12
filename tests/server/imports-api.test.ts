import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { buildXlsx } from '../../src/server/http/xlsx';
import { parseSheet } from '../../src/server/modules/imports/parse-row';
import { templateSheets } from '../../src/server/modules/imports/template';
import { readXlsx } from '../../src/server/modules/imports/xlsx-read';
import { FINMAP_COLUMNS } from '../../src/shared/finmap-format';
import type { ImportPreview } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeRow as fr, finmapLikeXlsx } from '../helpers/finmap-like';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { loginAs, ORIGIN_HEADERS, seedUser } from '../helpers/test-app';
import { buildZip } from '../helpers/zip-build';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const MB = 1024 * 1024;
const uploadUrl = (cid = w.cid) => `/api/v1/companies/${cid}/imports/upload`;
const previewUrl = (cid = w.cid) => `/api/v1/companies/${cid}/imports/preview`;

/** Загрузка файла телом запроса, как у вложений: octet-stream и имя в X-File-Name. */
function upload(data: Buffer, name = 'выгрузка.xlsx', cookie: string | null = w.h.cookie, url = uploadUrl()) {
  return w.h.t.app.inject({
    method: 'POST',
    url,
    headers: { ...ORIGIN_HEADERS, ...(cookie ? { cookie } : {}), 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    payload: data,
  });
}

const SAMPLE = [
  fr({ paidAt: at('2026-10-03', '22:07:00'), amount: 10596, to: 'Касса', category: 'Бар' }),
  fr({ paidAt: at('2026-10-04', '09:15:00'), amount: 500, from: 'Касса', to: 'Банк-2' }),
];

describe('POST …/imports/upload и …/imports/preview (§6.2, §6.3 спецификации импорта)', () => {
  it('загрузка → предпросмотр с токеном; пересчёт по кэшу с другим сопоставлением; ничего не записано', async () => {
    w = await opsWorld();
    const before = w.h.t.sqlite.prepare('SELECT (SELECT COUNT(*) FROM operations) + (SELECT COUNT(*) FROM accounts) + (SELECT COUNT(*) FROM categories) n').get();
    const res = await upload(finmapLikeXlsx(SAMPLE));
    expect(res.statusCode, res.body).toBe(200);
    const p = res.json() as ImportPreview;
    expect(p.token).toMatch(/^[0-9a-f]{32}$/);
    expect(p.file).toEqual({ name: 'выгрузка.xlsx', size: finmapLikeXlsx(SAMPLE).length, rows: 2 });
    expect(p.counts).toMatchObject({ income: 1, transfer: 1, add: 2 });
    expect(p.accounts.map((a) => [a.key, a.mapping?.kind])).toEqual([
      ['касса', 'existing'],
      ['банк-2', 'new'],
    ]);
    expect(p.canImport).toBe(true);

    const again = await w.h.req('POST', previewUrl(), {
      token: p.token,
      accounts: [{ key: 'банк-2', kind: 'new', name: 'Банк 2', currency: 'USD', balance: { mode: 'start', amount: 0 } }],
    });
    expect(again.statusCode, again.body).toBe(200);
    const q = again.json() as ImportPreview;
    expect(q.token).toBe(p.token);
    expect(q.accounts[1]).toMatchObject({ currency: 'USD', mapping: { name: 'Банк 2', currency: 'USD' } });
    expect(w.h.t.sqlite.prepare('SELECT (SELECT COUNT(*) FROM operations) + (SELECT COUNT(*) FROM accounts) + (SELECT COUNT(*) FROM categories) n').get()).toEqual(before);
  });

  it('CSV в UTF-8 с «;»; ошибки файла — 400 IMPORT_FILE с кодом и текстом', async () => {
    w = await opsWorld();
    const csv = Buffer.from('Дата платежа*;Сумма в валюте счета*;На счет*\n05.10.2026 10:00;1 500,50;Касса\n', 'utf8');
    const ok = await upload(csv, 'выгрузка.csv');
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as ImportPreview).accounts[0]!.movement).toBe(150050);

    const fileErr = async (data: Buffer, name: string) => {
      const res = await upload(data, name);
      expect(res.statusCode, res.body).toBe(400);
      const e = res.json().error;
      expect(e.code).toBe('IMPORT_FILE');
      return `${e.details.fileCode}: ${e.message}`;
    };
    expect(await fileErr(Buffer.alloc(0), 'пусто.csv')).toBe('F1: Файл пустой');
    expect(await fileErr(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'старый.xls')).toBe('F2: Старый формат .xls — сохраните файл как .xlsx');
    expect(await fileErr(Buffer.from('%PDF-1.4'), 'отчёт.pdf')).toBe('F2: Нужен файл .xlsx или .csv');
    // zip-бомба: лист объявлен маленьким, распаковывается в 70 МБ — распаковка прервана (Review Focus)
    const bomb = buildZip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="Л" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(70 * MB, 0x20), declaredSize: 1000 },
    ]);
    expect(await fileErr(bomb, 'бомба.xlsx')).toBe('F3: Файл повреждён или небезопасен: часть «xl/worksheets/sheet1.xml» распаковывается больше объявленного размера');
    const xxe = buildZip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="Л" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&e;</t></is></c></row></sheetData></worksheet>' },
    ]);
    expect(await fileErr(xxe, 'xxe.xlsx')).toBe('F3: Файл повреждён или небезопасен: объявления DOCTYPE и ENTITY запрещены');
    expect(await fileErr(buildZip([{ name: '../evil.xml', data: 'x' }]), 'slip.xlsx')).toBe('F3: Файл повреждён или небезопасен: недопустимое имя записи в архиве');
    expect(await fileErr(finmapLikeXlsx([], {}), 'пустой.xlsx')).toBe('F7: В файле нет операций');
  });

  it('пределы загрузки: больше 30 МБ — 413 «Файл больше 30 МБ»; без сессии — 401 до чтения тела; без X-Requested-With — 403; JSON и текст — 415, без тела — 400', async () => {
    w = await opsWorld();
    const big = await upload(Buffer.concat([finmapLikeXlsx(SAMPLE), Buffer.alloc(30 * MB)]));
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toEqual({ code: 'TOO_LARGE', message: 'Файл больше 30 МБ' });
    expect((await upload(finmapLikeXlsx(SAMPLE), 'x.xlsx', null)).statusCode).toBe(401);
    expect((await upload(finmapLikeXlsx(SAMPLE), 'x.xlsx', 'sid=forged')).statusCode).toBe(401);
    const csrf = await w.h.t.app.inject({
      method: 'POST',
      url: uploadUrl(),
      headers: { origin: 'http://localhost:3000', cookie: w.h.cookie, 'content-type': 'application/octet-stream' },
      payload: finmapLikeXlsx(SAMPLE),
    });
    expect(csrf.statusCode).toBe(403);
    // в области загрузки — только парсер байтов: JSON и текст — 415 (корневые парсеры не читают до 30 МБ); без тела — 400
    expect((await w.h.req('POST', uploadUrl(), { not: 'a file' })).statusCode).toBe(415);
    for (const type of ['application/json', 'text/plain']) {
      const other = await w.h.t.app.inject({
        method: 'POST',
        url: uploadUrl(),
        headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': type },
        payload: Buffer.alloc(2 * MB, 0x20),
      });
      expect(other.statusCode, type).toBe(415);
    }
    const noBody = await w.h.t.app.inject({ method: 'POST', url: uploadUrl(), headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie } });
    expect(noBody.statusCode).toBe(400);
    expect(noBody.json().error.fields).toEqual({ file: 'Нет файла' });
    // лимит 30 МБ и парсер байтов — только у загрузки: preview принимает JSON с общим лимитом
    const elsewhere = await w.h.t.app.inject({
      method: 'POST',
      url: previewUrl(),
      headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(16),
    });
    expect(elsewhere.statusCode).toBe(415);
  });

  it('лимит 30 МБ — у маршрута Fastify: сверх него 413 до обработчика (чужая компания — не 404); файл больше общего лимита 1 МБ принимается', async () => {
    w = await opsWorld();
    // обработчик ответил бы 404 «Компания не найдена»: 413 значит, что тело отвергнуто до него, без буферизации
    const big = await upload(Buffer.alloc(30 * MB + 1), 'x.xlsx', w.h.cookie, uploadUrl(999_999));
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toEqual({ code: 'TOO_LARGE', message: 'Файл больше 30 МБ' });
    const line = `05.10.2026 10:00;1 500,50;Касса;${'к'.repeat(100)}\n`;
    const csv = Buffer.from(`Дата платежа*;Сумма в валюте счета*;На счет*;Комментарий\n${line.repeat(6_000)}`, 'utf8');
    expect(csv.length).toBeGreaterThan(MB);
    const ok = await upload(csv, 'большой.csv');
    expect(ok.statusCode, ok.body.slice(0, 300)).toBe(200);
    expect((ok.json() as ImportPreview).file.rows).toBe(6_000);
  });

  it('имя файла: без управляющих символов, до 200 кодовых точек — суррогатная пара не разрезается; пустое — «Файл»', async () => {
    w = await opsWorld();
    const smile = '\u{1F600}';
    const long = await upload(finmapLikeXlsx(SAMPLE), `a\u0001b\u007F\u0085${smile.repeat(250)}`);
    expect(long.statusCode, long.body).toBe(200);
    const name = (long.json() as ImportPreview).file.name;
    expect(name).toBe(`ab${smile.repeat(198)}`);
    expect(Array.from(name)).toHaveLength(200);
    const empty = await upload(finmapLikeXlsx(SAMPLE), '\u0001\u0002\u009F');
    expect(empty.statusCode, empty.body).toBe(200);
    expect((empty.json() as ImportPreview).file.name).toBe('Файл');
  });

  it('токен: неизвестный, чужой компании или чужого пользователя — 410; архивная компания — 422 на обоих маршрутах; чужая — 404', async () => {
    w = await opsWorld();
    const p = (await upload(finmapLikeXlsx(SAMPLE))).json() as ImportPreview;
    const expired = await w.h.req('POST', previewUrl(), { token: '0'.repeat(32), accounts: [] });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error).toEqual({ code: 'IMPORT_EXPIRED', message: 'Проверка устарела — загрузите файл заново' });
    const other = await w.h.company('Другая');
    expect((await w.h.req('POST', previewUrl(other), { token: p.token, accounts: [] })).statusCode).toBe(410);

    await seedUser(w.h.t, 'second', 'second-password-1');
    const cookie2 = await loginAs(w.h.t, 'second', 'second-password-1');
    const asSecond = await w.h.t.app.inject({ method: 'POST', url: previewUrl(), headers: { ...ORIGIN_HEADERS, cookie: cookie2 }, payload: { token: p.token, accounts: [] } });
    expect(asSecond.statusCode).toBe(410);
    expect((await w.h.req('POST', previewUrl(), { token: p.token, accounts: [] })).statusCode).toBe(200);
    expect((await w.h.req('POST', previewUrl(), { token: 'плохой', accounts: [] })).statusCode).toBe(400);

    expect((await w.h.req('POST', `/api/v1/companies/${other}/archive`, {})).statusCode).toBe(200);
    const archived = await upload(finmapLikeXlsx(SAMPLE), 'x.xlsx', w.h.cookie, uploadUrl(other));
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error.code).toBe('ARCHIVED_REFERENCE');
    expect((await w.h.req('POST', previewUrl(other), { token: p.token, accounts: [] })).json().error.code).toBe('ARCHIVED_REFERENCE');
    expect((await upload(finmapLikeXlsx(SAMPLE), 'x.xlsx', w.h.cookie, uploadUrl(999_999))).statusCode).toBe(404);
  });
});

describe('GET /api/v1/imports/template.xlsx (§5.2)', () => {
  it('шаблон: «Шаблон» — заголовки A–P со звёздочками, общие строки; «Инструкция» — три примера, которые проходят разбор', async () => {
    w = await opsWorld();
    const res = await w.h.req('GET', '/api/v1/imports/template.xlsx');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('Шаблон импорта.xlsx'));
    expect(res.headers['cache-control']).toBe('private, no-store');
    const zip = new AdmZip(res.rawPayload);
    expect(zip.getEntry('xl/sharedStrings.xml')).not.toBeNull();
    expect(zip.getEntry('xl/workbook.xml')!.getData().toString('utf8')).toContain('<sheet name="Шаблон" sheetId="1" r:id="rId1"/><sheet name="Инструкция" sheetId="2" r:id="rId2"/>');
    const first = readXlsx(res.rawPayload);
    expect(first.rows).toHaveLength(1);
    expect([...first.rows[0]!.cells.values()].map((c) => c.value)).toEqual(FINMAP_COLUMNS.map((c) => c.header));

    // примеры «Инструкции» (строки 2–4 под заголовками, правила — ниже) — доход, расход, перевод — проходят разбор без ошибок
    const instruction = readXlsx(buildXlsx(templateSheets()[1]!));
    expect(instruction.rows.length).toBeGreaterThan(10);
    const examples = { ...instruction, rows: instruction.rows.filter((r) => r.row <= 4) };
    const parsed = parseSheet(examples, { timezone: 'Asia/Almaty', baseCurrency: 'KZT', today: '2026-10-12' });
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows.map((r) => [r.type, r.amount, r.account.name, r.toAccount?.name ?? null])).toEqual([
      ['income', '15000', 'Касса', null],
      ['expense', '8500.5', 'Касса', null],
      ['transfer', '50000', 'Касса', 'Банк'],
    ]);
    expect((await w.h.t.app.inject({ method: 'GET', url: '/api/v1/imports/template.xlsx' })).statusCode).toBe(401);
  });
});

describe('большой файл (Review Focus 5)', () => {
  it('16 000 строк «как у Finmap»: загрузка и пересчёт без квадратичных проходов; ответ меньше 200 КБ', { timeout: 60_000 }, async () => {
    w = await opsWorld();
    const rows = Array.from({ length: 16_000 }, (_, i) => {
      const day = new Date(Date.UTC(2023, 2, 15) + Math.floor(i / 14) * 86_400_000).toISOString().slice(0, 10);
      const income = i % 3 !== 0;
      return fr({
        paidAt: at(day, `${String(8 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`),
        amount: 1000 + (i % 977) + 0.5,
        baseAmount: 1000 + (i % 977) + 0.5,
        ...(income ? { to: i % 2 ? 'Касса-1' : 'Банк-2' } : { from: 'Касса-1' }),
        category: income ? `Доход ${i % 15}` : i % 4 ? 'Зарплата' : `Расход ${i % 22}`,
        counterparty: `Контрагент ${i % 86}`,
        tags: i % 50 ? null : 'Смена',
        comment: i % 7 ? null : `Комментарий ${i}`,
      });
    });
    const file = finmapLikeXlsx(rows); // файл собирается до замера: меряется только сервер
    const t0 = performance.now();
    const res = await upload(file, 'большой.xlsx');
    const t1 = performance.now();
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    const p = res.json() as ImportPreview;
    expect(p.counts).toMatchObject({ add: 16_000, duplicates: 0 });
    expect(p.create.counterparties.total).toBe(86);
    expect(res.rawPayload.length).toBeLessThan(200 * 1024);
    const again = await w.h.req('POST', previewUrl(), { token: p.token, accounts: [] });
    const t2 = performance.now();
    expect(again.statusCode).toBe(200);
    // бюджет §10 — 3 с и 1 с на эталонной машине; здесь — с запасом для медленного CI
    expect(t1 - t0).toBeLessThan(15_000);
    expect(t2 - t1).toBeLessThan(5_000);
  });
});
