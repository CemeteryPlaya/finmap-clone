import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ORIGIN_HEADERS } from '../helpers/test-app';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const upload = (url: string, data: Buffer, name = 'чек.png', cookie: string | null = w.h.cookie) =>
  w.h.t.app.inject({
    method: 'POST',
    url,
    headers: {
      ...ORIGIN_HEADERS,
      ...(cookie ? { cookie } : {}),
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(name),
    },
    payload: data,
  });
const newOp = async () => (await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 100 })).operation.id as number;
const uploadsCount = () => (fs.existsSync(w.h.t.config.uploadsDir) ? fs.readdirSync(w.h.t.config.uploadsDir).length : 0);

describe('attachments', () => {
  it('загрузка, список, скачивание как файл, мягкое удаление; файл остаётся на диске', async () => {
    w = await opsWorld();
    const opId = await newOp();
    const res = await upload(`${w.ops}/${opId}/attachments`, PNG, 'чек (1).png');
    expect(res.statusCode).toBe(201);
    const att = res.json().attachment;
    expect(att).toMatchObject({ operationId: opId, originalName: 'чек (1).png', mime: 'image/png', size: PNG.length, deletedAt: null });
    expect(att.storedName).toMatch(/^[0-9a-f-]{36}\.png$/);
    const onDisk = path.join(w.h.t.config.uploadsDir, att.storedName);
    expect(fs.readFileSync(onDisk).equals(PNG)).toBe(true);
    expect((await w.h.req('GET', `${w.ops}/${opId}/attachments`)).json().attachments).toHaveLength(1);

    const file = await w.h.req('GET', `/api/v1/companies/${w.cid}/attachments/${att.id}`);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(PNG)).toBe(true);
    expect(file.headers['content-type']).toBe('application/octet-stream');
    // RFC 8187: скобки тоже кодируются; запасное ASCII-имя для старых клиентов
    expect(file.headers['content-disposition']).toBe(`attachment; filename="___ (1).png"; filename*=UTF-8''%D1%87%D0%B5%D0%BA%20%281%29.png`);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toBe('private, no-store');

    expect((await w.h.req('DELETE', `/api/v1/companies/${w.cid}/attachments/${att.id}`)).statusCode).toBe(204);
    expect((await w.h.req('GET', `${w.ops}/${opId}/attachments`)).json().attachments).toEqual([]);
    expect((await w.h.req('GET', `/api/v1/companies/${w.cid}/attachments/${att.id}`)).statusCode).toBe(404);
    expect(fs.existsSync(onDisk)).toBe(true); // §4.5: физический файл не удаляется
    expect(w.h.auditCount('attachment', 'create')).toBe(1);
    expect(w.h.auditCount('attachment', 'delete')).toBe(1);
  });

  it('HTML со скриптом не принимается: тип определяется по содержимому (Review Focus 2)', async () => {
    w = await opsWorld();
    const opId = await newOp();
    const before = uploadsCount();
    const res = await upload(`${w.ops}/${opId}/attachments`, Buffer.from('<html><script>alert(1)</script></html>'), 'чек.png');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields.file).toBe('Допустимые файлы: PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV');
    expect(uploadsCount()).toBe(before);
  });

  it('проверки: пустой файл, без имени, больше 10 МБ, не octet-stream, без входа, чужая компания, удалённая операция (Review Focus 3)', async () => {
    w = await opsWorld();
    const opId = await newOp();
    const url = `${w.ops}/${opId}/attachments`;
    const before = uploadsCount();

    expect((await upload(url, Buffer.alloc(0))).json().error.fields.file).toBe('Файл пустой');
    expect((await upload(url, PNG, '\u200B')).json().error.fields.name).toBe('Имя файла: от 1 до 200 символов');
    const big = await upload(url, Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]));
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toEqual({ code: 'TOO_LARGE', message: 'Файл больше 10 МБ' });
    expect((await w.h.req('POST', url, { not: 'a file' })).json().error.fields.file).toBe('Нет файла');
    const anonymous = await upload(url, PNG, 'чек.png', null);
    expect(anonymous.statusCode).toBe(401);
    expect(uploadsCount()).toBe(before); // отказ — ничего не записано

    // лимит 10 МБ и парсер байтов действуют только на загрузку: остальным маршрутам octet-stream не принять
    const elsewhere = await w.h.t.app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(16),
    });
    expect(elsewhere.statusCode).toBe(415);

    const other = await w.h.company('Чужая');
    expect((await upload(`/api/v1/companies/${other}/operations/${opId}/attachments`, PNG)).statusCode).toBe(404);
    const att = (await upload(url, Buffer.from('a;b\n1;2\n'), 'выписка.csv')).json().attachment;
    expect(att.mime).toBe('text/csv');
    expect((await w.h.req('GET', `/api/v1/companies/${other}/attachments/${att.id}`)).statusCode).toBe(404);
    expect((await w.h.req('DELETE', `/api/v1/companies/${other}/attachments/${att.id}`)).statusCode).toBe(404);

    await w.h.req('DELETE', `${w.ops}/${opId}`);
    const toDeleted = await upload(url, PNG);
    expect(toDeleted.statusCode).toBe(409);
    expect(toDeleted.json().error.code).toBe('VERSION_CONFLICT');
  });

  it('расширение имени соответствует типу по содержимому: чужое дополняется своим (§8)', async () => {
    w = await opsWorld();
    const opId = await newOp();
    const url = `${w.ops}/${opId}/attachments`;
    const html = (await upload(url, PNG, 'x.html')).json().attachment;
    expect(html.originalName).toBe('x.html.png');
    const file = await w.h.req('GET', `/api/v1/companies/${w.cid}/attachments/${html.id}`);
    expect(file.headers['content-disposition']).toContain('filename="x.html.png"');
    expect(file.headers['content-length']).toBe(String(PNG.length));
    expect((await upload(url, PNG, 'ЧЕК.PNG')).json().attachment.originalName).toBe('ЧЕК.PNG');
    expect((await upload(url, PNG, 'чек')).json().attachment.originalName).toBe('чек.png');
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
    expect((await upload(url, JPEG, 'photo.jpeg')).json().attachment.originalName).toBe('photo.jpeg');
    expect((await upload(url, JPEG, 'photo.png')).json().attachment.originalName).toBe('photo.png.jpg');
    // слишком длинное имя укорачивается, а добавленное расширение остаётся
    const long = (await upload(url, PNG, 'a'.repeat(200))).json().attachment.originalName as string;
    expect(long).toBe('a'.repeat(196) + '.png');
  });

  it('подделанная кука сессии: 401 и ничего не записано', async () => {
    w = await opsWorld();
    const opId = await newOp();
    const before = uploadsCount();
    const res = await upload(`${w.ops}/${opId}/attachments`, PNG, 'x.png', 'sid=forged');
    expect(res.statusCode).toBe(401);
    expect(uploadsCount()).toBe(before);
  });

  it('413 на других маршрутах — общее сообщение, не про файл', async () => {
    w = await opsWorld();
    const res = await w.h.req('POST', '/api/v1/companies', { name: 'x'.repeat(2 * 1024 * 1024) });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toEqual({ code: 'TOO_LARGE', message: 'Слишком большой запрос' });
  });

  it('сбой записи в БД удаляет уже записанный файл (Review Focus 3)', async () => {
    w = await opsWorld();
    const opId = await newOp();
    const before = uploadsCount();
    w.h.t.sqlite.exec("CREATE TEMP TRIGGER audit_down BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END");
    expect((await upload(`${w.ops}/${opId}/attachments`, PNG)).statusCode).toBe(500);
    w.h.t.sqlite.exec('DROP TRIGGER audit_down');
    expect(uploadsCount()).toBe(before);
    expect((w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM attachments').get() as { n: number }).n).toBe(0);
  });
});
