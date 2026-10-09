import { afterEach, describe, expect, it } from 'vitest';
import { resolveClientIp } from '../../src/server/security/client-ip';
import { createTestApp, type TestApp } from '../helpers/test-app';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.cleanup();
  t = null;
});

const MODE_ENV = {
  cloudflare: { DEPLOY_MODE: 'cloudflare', CF_TUNNEL_TOKEN: 't' },
  ngrok: { DEPLOY_MODE: 'ngrok', NGROK_AUTHTOKEN: 'a', NGROK_DOMAIN: 'x.ngrok-free.app' },
  vps: { DEPLOY_MODE: 'vps', PUBLIC_URL: 'https://fin.example.kz' },
} as const;

async function ipOf(mode: keyof typeof MODE_ENV, headers: Record<string, string>, remoteAddress = '127.0.0.1') {
  await t?.cleanup();
  t = await createTestApp({ ...MODE_ENV[mode] }, (app) => {
    app.get('/api/v1/__test/ip', async (req) => ({ ip: resolveClientIp(req, mode) }));
  });
  const res = await t.app.inject({ method: 'GET', url: '/api/v1/__test/ip', headers, remoteAddress });
  return res.json().ip as string;
}

describe('resolveClientIp', () => {
  it('в режиме ngrok игнорирует CF-Connecting-IP и берёт правый недоверенный адрес X-Forwarded-For', async () => {
    expect(await ipOf('ngrok', { 'cf-connecting-ip': '6.6.6.6', 'x-forwarded-for': '6.6.6.6, 9.9.9.9' })).toBe('9.9.9.9');
  });

  it('в режиме vps подделка начала X-Forwarded-For не меняет IP', async () => {
    expect(await ipOf('vps', { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' })).toBe('9.9.9.9');
    expect(await ipOf('vps', { 'x-forwarded-for': '2.2.2.2, 9.9.9.9' })).toBe('9.9.9.9');
  });

  it('в режиме vps Caddy с loopback передаёт IP клиента в X-Forwarded-For; CF-Connecting-IP игнорируется', async () => {
    expect(await ipOf('vps', { 'x-forwarded-for': '9.9.9.9' })).toBe('9.9.9.9');
    expect(await ipOf('vps', { 'x-forwarded-for': '9.9.9.9', 'cf-connecting-ip': '6.6.6.6' })).toBe('9.9.9.9');
  });

  it('в режиме vps прямое подключение не с loopback: X-Forwarded-For не учитывается', async () => {
    expect(await ipOf('vps', { 'x-forwarded-for': '9.9.9.9' }, '192.168.1.20')).toBe('192.168.1.20');
  });

  it('в режиме cloudflare с loopback учитывает CF-Connecting-IP', async () => {
    expect(await ipOf('cloudflare', { 'cf-connecting-ip': '5.5.5.5', 'x-forwarded-for': '5.5.5.5' })).toBe('5.5.5.5');
  });

  it('в режиме cloudflare не с loopback (локальная сеть) CF-Connecting-IP игнорируется', async () => {
    expect(await ipOf('cloudflare', { 'cf-connecting-ip': '5.5.5.5' }, '192.168.1.20')).toBe('192.168.1.20');
  });
});
