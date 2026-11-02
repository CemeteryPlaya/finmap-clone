import { afterEach, describe, expect, it } from 'vitest';
import { createAdminTokenSource } from '../../src/server/modules/senet/admin-source';
import { SenetError, type SenetSource } from '../../src/server/modules/senet/source';
import { startSenetFake, type SenetFake } from '../helpers/senet-fake';
import { senetSample, TWO_SHIFTS } from '../helpers/senet-samples';

const OFFICE = { officeId: 1, cashDeskId: 1 };
const FROM = new Date('2026-10-01T00:00:00.000Z');
const TO = new Date('2026-10-02T00:00:00.000Z');
const sessions = () => senetSample('sessions', TWO_SHIFTS);

let fake: SenetFake | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

async function setup(o: { report?: SenetFake['report']; token?: string; password?: string; code?: boolean } = {}) {
  fake = await startSenetFake({ users: { reports: { password: 'верный', token: 'tok-1', code: o.code } }, report: o.report ?? (() => sessions()) });
  fake.tokens.clear();
  const sleeps: number[] = [];
  const saved: string[] = [];
  const source: SenetSource = createAdminTokenSource({
    org: 'club-demo',
    credentials: { username: 'reports', password: o.password ?? 'верный', token: o.token },
    timezone: 'Asia/Almaty',
    base: fake.base,
    sleep: async (ms) => void sleeps.push(ms),
    onToken: async (t) => void saved.push(t),
  });
  return { fake, source, sleeps, saved };
}

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SenetError);
    return (e as SenetError).code;
  }
  throw new Error('ожидалась ошибка');
};

/** AdminTokenSource: вход админ-панели и отчёты xlsx (план 2026-11-02-senet-autopost, задача 4). */
describe('AdminTokenSource', () => {
  it('первый запрос входит, сохраняет токен и запрашивает отчёт с параметрами', async () => {
    const { fake, source, saved } = await setup();
    const { rows, raw } = await source.report('sessions', OFFICE, FROM, TO);
    expect(rows).toHaveLength(2);
    expect(raw.contentType).toContain('xlsx');
    expect(raw.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(saved).toEqual(['tok-1']);
    const report = fake.requests.find((r) => r.method === 'GET')!;
    expect(report.authorization).toBe('Token tok-1');
    expect(report.query).toEqual({
      format: 'xlsx',
      office_id: '1',
      type: 'cashdesk_session',
      from_date: '2026-10-01T00:00:00.000Z',
      to_date: '2026-10-02T00:00:00.000Z',
      cash_desk_id: '1',
    });
  });

  it('есть токен — вход не вызывается', async () => {
    const { fake, source } = await setup({ token: 'tok-1' });
    fake.tokens.add('tok-1');
    await source.report('cashMoves', OFFICE, FROM, TO).catch(() => null);
    expect(fake.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    expect(fake.requests[0]!.query.type).toBe('income_outcome');
    expect(fake.requests[0]!.query.cash_desk_id).toBeUndefined();
  });

  it('401 на отчёт — один повторный вход и повтор; снова 401 — auth_rejected', async () => {
    const { fake, source, saved } = await setup({ token: 'old-token' });
    await source.report('sessions', OFFICE, FROM, TO);
    expect(saved).toEqual(['tok-1']);
    expect(fake.requests.map((r) => r.method)).toEqual(['GET', 'POST', 'GET']);
    await fake.close();

    // вход выдаёт токен, но отчёты его не принимают
    const s2 = await setup({ token: 'old-token' });
    s2.fake.report = () => ({ status: 401, body: '{"detail":"Invalid token."}', contentType: 'application/json' });
    expect(await codeOf(s2.source.report('sessions', OFFICE, FROM, TO))).toBe('auth_rejected');
  });

  it('токен с не-ASCII знаками: есть пароль — новый вход; только токен — auth_rejected, а не «сервер не отвечает»', async () => {
    const { fake, source } = await setup({ token: 'токен' });
    await source.report('sessions', OFFICE, FROM, TO);
    expect(fake.requests.map((r) => r.method)).toEqual(['POST', 'GET']);
    await fake.close();
    const s2 = await setup();
    const tokenOnly = createAdminTokenSource({ org: 'club-demo', credentials: { token: 'токен' }, timezone: 'Asia/Almaty', base: s2.fake.base, sleep: async () => {} });
    expect(await codeOf(tokenOnly.report('sessions', OFFICE, FROM, TO))).toBe('auth_rejected');
  });

  it('неверный пароль — auth_rejected; вход с кодом — auth_needs_code', async () => {
    expect(await codeOf((await setup({ password: 'неверный' })).source.report('sessions', OFFICE, FROM, TO))).toBe('auth_rejected');
    expect(await codeOf((await setup({ code: true })).source.report('sessions', OFFICE, FROM, TO))).toBe('auth_needs_code');
  });

  it('503 — повтор через 5 с, снова 503 — server_error со статусом', async () => {
    const { source, sleeps } = await setup({ report: () => ({ status: 503, body: 'занят' }) });
    try {
      await source.report('sessions', OFFICE, FROM, TO);
      expect.unreachable();
    } catch (e) {
      expect((e as SenetError).code).toBe('server_error');
      expect((e as SenetError).status).toBe(503);
    }
    expect(sleeps).toContain(5000);
  });

  it('сервер недоступен — unreachable', async () => {
    const { fake, source } = await setup();
    await fake.close();
    expect(await codeOf(source.report('sessions', OFFICE, FROM, TO))).toBe('unreachable');
  });

  it('200 с HTML — bad_format, сырой файл приложен к ошибке', async () => {
    const { source } = await setup({ report: () => ({ status: 200, body: '<html>вход</html>', contentType: 'text/html' }) });
    try {
      await source.report('sessions', OFFICE, FROM, TO);
      expect.unreachable();
    } catch (e) {
      expect((e as SenetError).code).toBe('bad_format');
      expect((e as SenetError).raw?.data.toString()).toContain('html');
    }
  });

  it('ответ больше 20 МБ по content-length — too_large', async () => {
    const { source } = await setup({ report: () => ({ status: 200, body: Buffer.alloc(21 * 1024 * 1024), contentType: 'application/xlsx' }) });
    expect(await codeOf(source.report('sessions', OFFICE, FROM, TO))).toBe('too_large');
  });

  it('перенаправление не выполняется — server_error', async () => {
    const { source } = await setup({ report: () => ({ status: 302, body: '', headers: { location: 'https://example.com/' } }) });
    expect(await codeOf(source.report('sessions', OFFICE, FROM, TO))).toBe('server_error');
  });

  it('между отчётами — пауза 200 мс', async () => {
    const { source, sleeps } = await setup();
    await source.report('sessions', OFFICE, FROM, TO);
    await source.report('sessions', OFFICE, FROM, TO);
    expect(sleeps).toEqual([200]);
  });

  it('check — смены за последние сутки, имя офиса; выход из сессии не вызывается никогда', async () => {
    const { fake, source } = await setup();
    const now = new Date('2026-10-02T06:00:00.000Z');
    expect(await source.check(OFFICE, now)).toEqual({ officeName: 'Клуб 1', shifts: 2, lastClosedAt: '2026-10-02T04:57:46.000Z' });
    const q = fake.requests.find((r) => r.method === 'GET')!.query;
    expect([q.from_date, q.to_date]).toEqual(['2026-10-01T06:00:00.000Z', '2026-10-02T06:00:00.000Z']);
    expect(fake.requests.some((r) => r.url.includes('disconnect'))).toBe(false);
  });

  it('org не по правилу — ошибка до запроса', () => {
    expect(() => createAdminTokenSource({ org: 'evil.com/x', credentials: {}, timezone: 'Asia/Almaty' })).toThrow(/адрес организации/i);
  });
});
