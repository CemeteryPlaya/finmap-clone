import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createSenetConnections } from '../../src/server/modules/senet/connections';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { startSenetFake, type SenetFake } from '../helpers/senet-fake';
import { senetSample, TWO_SHIFTS } from '../helpers/senet-samples';

const NOW = '2026-10-02T06:00:00.000Z';
const KEY = crypto.randomBytes(32).toString('base64');
const PASSWORD = 'верный-пароль-1';

let fake: SenetFake;
let w: OpsWorld;
let base: string;
beforeEach(async () => {
  fake = await startSenetFake({ users: { reports: { password: PASSWORD, token: 'tok-abcd1234' } }, report: () => senetSample('sessions', TWO_SHIFTS) });
  w = await opsWorld(NOW, { SENET_API_BASE: fake.base, SECRET_KEY: KEY });
  base = `/api/v1/companies/${w.cid}/senet`;
});
afterEach(async () => {
  await w.h.t.cleanup();
  await fake.close();
});

const byPassword = { name: 'Клубы', org: 'club-demo', authMethod: 'password', username: 'reports', password: PASSWORD };

async function connection() {
  const res = await w.h.req('POST', `${base}/connections`, byPassword);
  expect(res.statusCode).toBe(201);
  return res.json().connection as { id: number };
}

async function kztAccount(name: string) {
  return (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name, currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
}

/** Подключения и клубы Senet (план 2026-11-02-senet-autopost, задача 5). */
describe('подключения Senet', () => {
  it('«Проверить»: верный пароль — имя клуба и смены за сутки; неверный — 422 с текстом §11', async () => {
    const ok = await w.h.req('POST', `${base}/connections/check`, { ...byPassword, officeId: 1, cashDeskId: 1 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ officeName: 'Клуб 1', shifts: 2, lastClosedAt: '2026-10-02T04:57:46.000Z' });
    const bad = await w.h.req('POST', `${base}/connections/check`, { ...byPassword, password: 'нет', officeId: 1, cashDeskId: 1 });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.message).toBe('Senet не принял данные входа. Обновите их в настройках подключения');
  });

  it('создание: пароль только зашифрованным, наружу — подсказка, в истории — без секретов', async () => {
    const res = await w.h.req('POST', `${base}/connections`, byPassword);
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain(PASSWORD);
    expect(res.json().connection).toMatchObject({ name: 'Клубы', org: 'club-demo', source: 'admin_token', authMethod: 'password', credentialsHint: 'reports', status: 'ok', offices: [] });
    const [row] = await w.h.t.q('SELECT credentials_secret s FROM senet_connections');
    expect(String(row!.s)).not.toContain(PASSWORD);
    expect(String(row!.s)).not.toContain('reports');
    const audit = await w.h.t.q("SELECT action, diff FROM audit_log WHERE entity = 'senet_connection'");
    expect(audit.map((a) => a.action)).toEqual(['connect']);
    expect(String(audit[0]!.diff)).not.toMatch(/верный|secret|"password":|"token":/i);
    const list = await w.h.req('GET', `${base}/connections`);
    expect(list.body).not.toContain(PASSWORD);
  });

  it('токен: подсказка — четыре последних знака', async () => {
    const res = await w.h.req('POST', `${base}/connections`, { name: 'Т', org: 'club-demo', authMethod: 'token', token: 'tok-abcd1234' });
    expect(res.json().connection.credentialsHint).toBe('••••1234');
  });

  it('неверный адрес организации и пустой пароль — 400 с полями', async () => {
    const res = await w.h.req('POST', `${base}/connections`, { ...byPassword, org: 'evil.com/x', password: '' });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields).sort()).toEqual(['org', 'password']);
  });

  it('на Vercel без SECRET_KEY подключить нельзя', async () => {
    const svc = createSenetConnections({ db: w.h.t.db, audit: createAuditService(w.h.t.db), config: w.h.t.config, secrets: () => null, now: () => new Date(NOW) });
    await expect(svc.create(w.cid, { name: 'К', org: 'club-demo', authMethod: 'password', username: 'reports', password: PASSWORD, token: '' }, 1)).rejects.toMatchObject({
      status: 422,
      message: 'Задайте SECRET_KEY в настройках Vercel',
    });
  });

  it('после создания — обезличенные слова по умолчанию без категорий (П2)', async () => {
    await connection();
    const rules = await w.h.t.q('SELECT type, pattern, match, category_id c, flags FROM senet_rules ORDER BY id');
    expect(rules.map((r) => `${r.type}:${r.pattern}:${r.match}`)).toEqual([
      'kaspi:kaspi:phrase',
      'kaspi:каспи:phrase',
      'salary_word:zp:word',
      'salary_word:зп:word',
      'salary_word:зарплата:first',
      'salary_word:аванс:first',
      'extra_pay_word:dop:word',
      'extra_pay_word:доп:word',
      'trainee:stajer:contains',
      'trainee:stazher:contains',
      'trainee:стажер:contains',
      'lunch:obed:first',
      'lunch:обед:first',
      'lunch:еда:first',
      'bar_item:brak:contains',
      'bar_item:брак:contains',
    ]);
    expect(rules.every((r) => r.c === null)).toBe(true);
    expect(rules.filter((r) => r.type === 'bar_item').map((r) => JSON.parse(String(r.flags)))).toEqual([{ defect: true }, { defect: true }]);
    // второе подключение слова не дублирует
    await connection();
    expect((await w.h.t.q('SELECT COUNT(*) n FROM senet_rules'))[0]!.n).toBe(16);
  });

  it('замена данных входа возвращает статус ok; архив', async () => {
    const { id } = await connection();
    await w.h.t.q("UPDATE senet_connections SET status = 'key_rejected', last_error = 'x'");
    const res = await w.h.req('PATCH', `${base}/connections/${id}`, { credentials: { authMethod: 'token', token: 'tok-new-9999' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().connection).toMatchObject({ status: 'ok', lastError: null, authMethod: 'token', credentialsHint: '••••9999' });
    const arch = await w.h.req('PATCH', `${base}/connections/${id}`, { archived: true });
    expect(arch.json().connection.archivedAt).not.toBeNull();
  });

  it('удаление: при проводках — 409; без них — 204, клубы и смены удалены', async () => {
    const { id } = await connection();
    const office = await w.h.req('POST', `${base}/connections/${id}/offices`, { senetOfficeId: 1, cashDeskId: 1, enabled: false });
    expect(office.statusCode).toBe(201);
    const oid = office.json().office.id as number;
    await w.h.t.q("INSERT INTO senet_shifts (office_id, opened_at, end_balance, updated_at) VALUES (?, 'a', 0, 'x')", oid);
    await w.h.t.q("INSERT INTO senet_postings (shift_id, kind, amount, created_at) VALUES ((SELECT id FROM senet_shifts), 'cash', 1, 'x')");
    expect((await w.h.req('DELETE', `${base}/connections/${id}`)).statusCode).toBe(409);
    await w.h.t.q('DELETE FROM senet_postings');
    expect((await w.h.req('DELETE', `${base}/connections/${id}`)).statusCode).toBe(204);
    expect((await w.h.t.q('SELECT COUNT(*) n FROM senet_shifts'))[0]!.n).toBe(0);
    expect((await w.h.t.q('SELECT COUNT(*) n FROM senet_offices'))[0]!.n).toBe(0);
  });
});

describe('клубы подключения', () => {
  it('включённый клуб: связи обязательны; счёт не в KZT — 422; проект — у одного клуба', async () => {
    const { id } = await connection();
    const url = `${base}/connections/${id}/offices`;
    const empty = await w.h.req('POST', url, { senetOfficeId: 1, cashDeskId: 1, enabled: true });
    expect(empty.statusCode).toBe(400);
    expect(Object.keys(empty.json().error.fields).sort()).toEqual(['cashAccountId', 'historyFrom', 'incomeCategoryId', 'kaspiAccountId', 'projectId']);

    const kaspi = await kztAccount('Kaspi Клуб 1');
    const good = {
      senetOfficeId: 1,
      cashDeskId: 1,
      name: 'Клуб 1',
      enabled: true,
      projectId: w.project,
      cashAccountId: w.kzt,
      kaspiAccountId: kaspi,
      incomeCategoryId: w.income,
      historyFrom: '2026-10-08T05:00:00.000Z',
      cashOffset: 8800,
    };
    const usd = await w.h.req('POST', url, { ...good, kaspiAccountId: w.usd });
    expect(usd.statusCode).toBe(422);
    expect(usd.json().error.fields.kaspiAccountId).toBe('Валюта счёта не совпадает с валютой Senet (KZT)');

    const created = await w.h.req('POST', url, good);
    expect(created.statusCode).toBe(201);
    expect(created.json().office).toMatchObject({ ...good, id: expect.any(Number) });

    const second = await w.h.req('POST', url, { ...good, senetOfficeId: 2 });
    expect(second.statusCode).toBe(422);
    expect(second.json().error.fields.projectId).toBe('Проект уже связан с другим клубом Senet');

    const dup = await w.h.req('POST', url, { ...good, enabled: false });
    expect(dup.statusCode).toBe(422);
    expect(dup.json().error.message).toBe('Этот клуб Senet уже подключён');

    const patched = await w.h.req('PATCH', `${base}/offices/${created.json().office.id}`, { ...good, cashOffset: 0 });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().office.cashOffset).toBe(0);

    const list = (await w.h.req('GET', `${base}/connections`)).json().connections;
    expect(list[0].offices).toHaveLength(1);
  });
});
