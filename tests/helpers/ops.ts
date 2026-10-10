import { createApi, type ApiHarness } from './api';

export interface OpsWorld {
  h: ApiHarness;
  cid: number;
  /** Счета: KZT и USD (открыты 2026-10-01, остаток 0). */
  kzt: number;
  usd: number;
  income: number;
  expense: number;
  project: number;
  project2: number;
  counterparty: number;
  tag: number;
  /** URL операций компании. */
  ops: string;
  /** POST с проверкой успеха; возвращает JSON. */
  post(url: string, body: unknown): Promise<any>;
}

/**
 * Компания с двумя счетами, категориями обоих видов, двумя проектами, контрагентом, тегом
 * и ручным курсом USD 475.12 на 2026-10-01. По умолчанию «сейчас» — 2026-10-06 12:00 UTC (17:00 по Алматы).
 */
export async function opsWorld(now = '2026-10-06T12:00:00.000Z'): Promise<OpsWorld> {
  const h = await createApi(now);
  const cid = await h.company('ТОО');
  const base = `/api/v1/companies/${cid}`;
  const post = async (url: string, body: unknown) => {
    const res = await h.req('POST', url, body);
    if (res.statusCode >= 300) throw new Error(`POST ${url}: ${res.statusCode} ${res.body}`);
    return res.json();
  };
  const account = async (name: string, currency: string) =>
    (await post(`${base}/accounts`, { name, currency, openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
  const kzt = await account('Касса', 'KZT');
  const usd = await account('Валютный', 'USD');
  const income = (await post(`${base}/categories`, { kind: 'income', name: 'Бар' })).category.id as number;
  const expense = (await post(`${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id as number;
  const project = (await post(`${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id as number;
  const project2 = (await post(`${base}/projects`, { name: 'Клуб 2', templateKey: 'general' })).project.id as number;
  const counterparty = (await post(`${base}/counterparties`, { type: 'client', name: 'ИП Клиент' })).counterparty.id as number;
  const tag = (await post(`${base}/tags`, { name: 'Смена' })).tag.id as number;
  await post('/api/v1/rates/manual', { date: '2026-10-01', currency: 'USD', rate: '475.12' });
  return { h, cid, kzt, usd, income, expense, project, project2, counterparty, tag, ops: `${base}/operations`, post };
}
