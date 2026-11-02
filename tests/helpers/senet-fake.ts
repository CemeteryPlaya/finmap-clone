import Fastify from 'fastify';
import { senetSample } from './senet-samples';

/** Отчёты для аналитики: пустые, если тест не просит их сам (ownAnalytics). */
const ANALYTICS = { sold_check_items: 'soldItems', checks: 'checks', refill: 'refills', shop_quantity: 'stock', movements_of_goods: 'goodsMoves', office_load_by_zones: 'load' } as const;

/**
 * Поддельный сервер Senet (план 2026-11-02-senet-autopost, задача 4): вход админ-панели и отчёты. Отчёт — функция от
 * type и параметров запроса; она возвращает xlsx или готовый ответ { status, body, contentType }.
 */
export interface FakeUser {
  password: string;
  token: string;
  /** Вход требует кода подтверждения. */
  code?: boolean;
}

export type FakeReply = Buffer | { status: number; body: string | Buffer; contentType?: string; headers?: Record<string, string> };

export interface FakeRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  query: Record<string, string>;
}

export interface SenetFake {
  base: string;
  requests: FakeRequest[];
  /** Действующие токены: отчёт с другим токеном получает 401. */
  tokens: Set<string>;
  users: Record<string, FakeUser>;
  report: (type: string, query: Record<string, string>) => FakeReply;
  close(): Promise<void>;
}

export async function startSenetFake(o: { users?: Record<string, FakeUser>; report?: SenetFake['report']; ownAnalytics?: boolean } = {}): Promise<SenetFake> {
  const app = Fastify({ logger: false });
  const fake: SenetFake = {
    base: '',
    requests: [],
    tokens: new Set(Object.values(o.users ?? {}).map((u) => u.token)),
    users: o.users ?? {},
    report: o.report ?? (() => ({ status: 404, body: 'нет отчёта' })),
    close: () => app.close(),
  };
  const record = (req: { method: string; url: string; headers: Record<string, unknown>; query: unknown }) =>
    fake.requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization as string | undefined, query: (req.query ?? {}) as Record<string, string> });

  app.post('/api/v2/user/idm_admin_auth/', async (req, reply) => {
    record(req);
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    const user = username ? fake.users[username] : undefined;
    if (!user || user.password !== password) return reply.code(400).send({ detail: 'Неверный логин или пароль' });
    if (user.code) return reply.send({ needs_verification: true });
    fake.tokens.add(user.token);
    return reply.send({ token: user.token });
  });

  app.get('/api/v2/stat/reports/', async (req, reply) => {
    record(req);
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Token ') || !fake.tokens.has(auth.slice(6))) return reply.code(401).send({ detail: 'Invalid token.' });
    const q = req.query as Record<string, string>;
    const analytics = ANALYTICS[q.type as keyof typeof ANALYTICS];
    const r = analytics && !o.ownAnalytics ? senetSample(analytics, []) : fake.report(q.type ?? '', q);
    if (Buffer.isBuffer(r)) return reply.header('content-type', 'application/xlsx').send(r);
    for (const [k, v] of Object.entries(r.headers ?? {})) reply.header(k, v);
    return reply
      .code(r.status)
      .header('content-type', r.contentType ?? 'text/plain')
      .send(r.body);
  });

  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  fake.base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return fake;
}
