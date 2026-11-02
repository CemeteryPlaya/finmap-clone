import crypto from 'node:crypto';
import { REPORT_TYPES, SenetError, type OfficeRef, type RawFile, type ReportKind, type ReportRows, type SenetSource } from './source';
import { parseReport } from './xlsx-reports';

/** Правило адреса организации (С15§3.2): адрес нельзя направить на чужой хост. */
export const ORG_RE = /^[a-z0-9-]{1,63}$/;

export interface AdminCredentials {
  username?: string;
  password?: string;
  token?: string;
}

const TIMEOUT_MS = 60_000;
const MAX_BYTES = 20 * 1024 * 1024;
const PAUSE_MS = 200;
const RETRY_MS = 5_000;
const TOKEN_RE = /^[\x21-\x7e]+$/;

/**
 * Временный источник (§3.2–3.4): вход админ-панели по логину и паролю (или готовый токен) и отчёты xlsx.
 * Только вход (POST) и GET отчётов; выход из сессии не вызывается — он снял бы токен и у админ-панели.
 */
export function createAdminTokenSource(o: {
  org: string;
  credentials: AdminCredentials;
  timezone: string;
  fetch?: typeof fetch;
  /** SENET_API_BASE — только тесты и e2e. */
  base?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Новый токен после входа — сохранить в подключении. */
  onToken?: (token: string) => Promise<void>;
}): SenetSource {
  if (!ORG_RE.test(o.org)) throw new Error('Неверный адрес организации Senet: латиница, цифры и дефис');
  const base = (o.base ?? `https://${o.org}.app.enes.tech`).replace(/\/+$/, '');
  const host = new URL(base).host;
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { username, password } = o.credentials;
  const canLogin = Boolean(username && password);
  let token = o.credentials.token ?? null;
  let first = true;

  const call = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await doFetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new SenetError('unreachable', { host });
    }
  };

  async function login(): Promise<void> {
    if (!canLogin) throw new SenetError('auth_rejected');
    const res = await call(`${base}/api/v2/user/idm_admin_auth/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new SenetError('auth_rejected');
    if (res.status !== 200) throw new SenetError('server_error', { status: res.status });
    const json = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof json?.token !== 'string' || json.token === '') throw new SenetError('auth_needs_code');
    token = json.token;
    await o.onToken?.(token);
  }

  async function readCapped(res: Response): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body ?? []) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new SenetError('too_large');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async function download(url: string): Promise<{ data: Buffer; contentType: string }> {
    if (!first) await sleep(PAUSE_MS);
    first = false;
    // токен с не-ASCII знаками (вставлен с ошибкой) в заголовок не пройдёт — это отказ доступа, а не недоступность сервера
    if (token && !TOKEN_RE.test(token)) {
      if (!canLogin) throw new SenetError('auth_rejected');
      token = null;
    }
    if (!token) await login();
    let relogged = false;
    let retried = false;
    for (;;) {
      let res: Response;
      try {
        res = await call(url, { headers: { authorization: `Token ${token}`, accept: 'application/xlsx' } });
      } catch (e) {
        if (retried) throw e;
        retried = true;
        await sleep(RETRY_MS);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel();
        if (relogged || !canLogin) throw new SenetError('auth_rejected');
        relogged = true;
        await login();
        continue;
      }
      if (res.status >= 500 && !retried) {
        await res.body?.cancel();
        retried = true;
        await sleep(RETRY_MS);
        continue;
      }
      if (res.status !== 200) {
        await res.body?.cancel();
        throw new SenetError('server_error', { status: res.status });
      }
      if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
        await res.body?.cancel();
        throw new SenetError('too_large');
      }
      return { data: await readCapped(res), contentType: res.headers.get('content-type') ?? '' };
    }
  }

  async function fetchReport<K extends ReportKind>(kind: K, office: OfficeRef, from: Date, to: Date) {
    const q = new URLSearchParams({
      format: 'xlsx',
      office_id: String(office.officeId),
      type: REPORT_TYPES[kind],
      from_date: from.toISOString(),
      to_date: to.toISOString(),
    });
    if (kind === 'sessions') q.set('cash_desk_id', String(office.cashDeskId));
    const { data, contentType } = await download(`${base}/api/v2/stat/reports/?${q}`);
    const raw: RawFile = { data, contentType, sha256: crypto.createHash('sha256').update(data).digest('hex') };
    try {
      return { ...parseReport(kind, data, o.timezone), raw };
    } catch (e) {
      if (e instanceof SenetError) e.raw = raw;
      throw e;
    }
  }

  return {
    async report<K extends ReportKind>(kind: K, office: OfficeRef, from: Date, to: Date): Promise<{ rows: ReportRows[K]; raw: RawFile }> {
      const { rows, raw } = await fetchReport(kind, office, from, to);
      return { rows, raw };
    },
    async check(office, now) {
      const { rows, officeName } = await fetchReport('sessions', office, new Date(now.getTime() - 24 * 3600_000), now);
      const closed = rows.map((r) => r.closedAt).filter((t): t is string => t !== null);
      return { officeName, shifts: rows.length, lastClosedAt: closed.length ? closed.reduce((a, b) => (a > b ? a : b)) : null };
    },
  };
}
