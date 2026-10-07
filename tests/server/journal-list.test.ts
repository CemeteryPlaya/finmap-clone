import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ORIGIN_HEADERS } from '../helpers/test-app';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

interface Item {
  id: number;
  type: string;
  paidAt: string;
  amount: number;
  baseAmount: number;
  lines: { categoryId: number | null; projectId: number | null; amount: number }[];
  tagIds: number[];
  attachmentCount: number;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const get = (qs = '') => w.h.req('GET', qs ? `${w.ops}?${qs}` : w.ops);
const page = async (qs = ''): Promise<Page> => {
  const res = await get(qs);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Page;
};
const ids = async (qs = '') => (await page(qs)).items.map((i) => i.id);
/** Операция через API; по умолчанию — расход 10 ₸ со счёта KZT. */
const op = async (body: Record<string, unknown>) =>
  (await w.post(w.ops, { type: 'expense', accountId: w.kzt, amount: 1000, ...body })).operation.id as number;
const transfer = (paidAt: string, extra: Record<string, unknown> = {}) =>
  op({ type: 'transfer', paidAt, accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100, ...extra });
const q = (text: string) => `q=${encodeURIComponent(text)}`;
const fail = (res: LightMyRequestResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error as { message: string; fields?: Record<string, string> };
};
const upload = (opId: number) =>
  w.h.t.app.inject({
    method: 'POST',
    url: `${w.ops}/${opId}/attachments`,
    headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': 'check.png' },
    payload: PNG,
  });

describe('журнал: GET /companies/:cid/operations', () => {
  it('по умолчанию новые сверху, при равной дате — больший id выше; удалённые скрыты; строки, теги и число вложений', async () => {
    w = await opsWorld();
    const a = await op({ paidAt: '2026-10-02T10:00:00Z', tagIds: [w.tag], lines: [{ categoryId: w.expense, projectId: w.project, amount: 1000 }] });
    const b = await op({ paidAt: '2026-10-03T10:00:00Z' });
    const c = await op({ paidAt: '2026-10-03T10:00:00Z' });
    const d = await op({ paidAt: '2026-10-04T10:00:00Z' });
    await w.h.req('DELETE', `${w.ops}/${d}`);
    expect((await upload(a)).statusCode).toBe(201);
    const second = (await upload(a)).json().attachment.id as number;
    await w.h.req('DELETE', `/api/v1/companies/${w.cid}/attachments/${second}`);

    const p = await page();
    expect(p.items.map((i) => i.id)).toEqual([c, b, a]);
    expect(p.nextCursor).toBeNull();
    expect(p.items[2]).toMatchObject({
      id: a,
      type: 'expense',
      amount: 1000,
      tagIds: [w.tag],
      attachmentCount: 1,
      lines: [{ categoryId: w.expense, projectId: w.project, amount: 1000 }],
    });
    expect(p.items[0]!.attachmentCount).toBe(0);
  });

  it('период — по календарной дате оплаты в APP_TIMEZONE: 23:30 и 00:30 по Алматы попадают в разные дни (Review Focus 1)', async () => {
    w = await opsWorld();
    const late = await op({ paidAt: '2026-10-04T18:30:00Z' }); // 23:30 4 октября по Алматы
    const early = await op({ paidAt: '2026-10-04T19:30:00Z' }); // 00:30 5 октября по Алматы
    expect(await ids('from=2026-10-05&to=2026-10-05')).toEqual([early]);
    expect(await ids('to=2026-10-04')).toEqual([late]);
    expect(await ids('from=2026-10-04')).toEqual([early, late]);
  });

  it('поиск без учёта регистра и «ё»: комментарий, контрагент, счёт списания и зачисления, статья и проект строки; % и _ — буквально (Review Focus 2)', async () => {
    w = await opsWorld();
    const byComment = await op({ paidAt: '2026-10-02T10:00:00Z', comment: 'Ёлка в зале' });
    const byCounterparty = await op({ type: 'income', paidAt: '2026-10-02T11:00:00Z', counterpartyId: w.counterparty });
    const byAccount = await op({ paidAt: '2026-10-02T12:00:00Z', accountId: w.usd, amount: 100 });
    const byTarget = await transfer('2026-10-02T13:00:00Z');
    const bySplit = await op({
      paidAt: '2026-10-02T14:00:00Z',
      lines: [
        { projectId: w.project, amount: 500 },
        { categoryId: w.expense, projectId: w.project2, amount: 500 },
      ],
    });
    const percent = await op({ paidAt: '2026-10-02T15:00:00Z', comment: 'Предоплата 100% за_октябрь' });
    await op({ paidAt: '2026-10-02T16:00:00Z', comment: 'Предоплата 1000 заXоктябрь' });

    expect(await ids(q('ЕЛКА'))).toEqual([byComment]);
    expect(await ids(q('клиент'))).toEqual([byCounterparty]);
    expect(await ids(q('ВАЛЮТН'))).toEqual([byTarget, byAccount]);
    expect(await ids(q('аренд'))).toEqual([bySplit]);
    expect(await ids(q('клуб 2'))).toEqual([bySplit]);
    expect(await ids(q('100%'))).toEqual([percent]);
    expect(await ids(q('за_'))).toEqual([percent]);
    expect(await ids(q('нет такого'))).toEqual([]);
  });

  it('сумма от/до — в базовой валюте по baseAmount; тип — строкой или повтором ключа; счёт — списания или зачисления; контрагент; тег', async () => {
    w = await opsWorld();
    const usd = await op({ paidAt: '2026-10-02T10:00:00Z', accountId: w.usd, amount: 100 }); // $1,00 = 475,12 ₸
    const small = await op({ paidAt: '2026-10-02T11:00:00Z', amount: 1000 }); // 10 ₸
    const income = await op({ type: 'income', paidAt: '2026-10-02T12:00:00Z', counterpartyId: w.counterparty, tagIds: [w.tag] });
    const tr = await transfer('2026-10-02T13:00:00Z');

    expect(await ids('amountMin=40000&amountMax=47512')).toEqual([tr, usd]);
    expect(await ids('amountMax=40000')).toEqual([income, small]);
    expect(await ids('types=income')).toEqual([income]);
    expect(await ids('types=income&types=transfer')).toEqual([tr, income]);
    expect(await ids(`accountIds=${w.usd}`)).toEqual([tr, usd]);
    expect(await ids(`counterpartyIds=${w.counterparty}`)).toEqual([income]);
    expect(await ids(`tagIds=${w.tag}`)).toEqual([income]);
    expect(await ids(`types=expense&accountIds=${w.kzt}`)).toEqual([small]);
  });

  it('статьи: родительская включает дочерние, подходит любая строка разбиения; проекты — любая строка', async () => {
    w = await opsWorld();
    const base = `/api/v1/companies/${w.cid}/categories`;
    const parent = (await w.post(base, { kind: 'expense', name: 'Помещение' })).category.id as number;
    const child = (await w.post(base, { kind: 'expense', name: 'Коммуналка', parentId: parent })).category.id as number;
    const a = await op({ paidAt: '2026-10-02T10:00:00Z', lines: [{ categoryId: child, amount: 1000 }] });
    const b = await op({
      paidAt: '2026-10-02T11:00:00Z',
      lines: [
        { projectId: w.project, amount: 400 },
        { categoryId: w.expense, projectId: w.project2, amount: 600 },
      ],
    });
    expect(await ids(`categoryIds=${parent}`)).toEqual([a]);
    expect(await ids(`categoryIds=${child}`)).toEqual([a]);
    expect(await ids(`categoryIds=${w.expense}`)).toEqual([b]);
    expect(await ids(`categoryIds=${parent}&categoryIds=${w.expense}`)).toEqual([b, a]);
    expect(await ids(`projectIds=${w.project2}`)).toEqual([b]);
  });

  it('«без статьи», «без проекта», «без контрагента» — по §6; с выбранными элементами того же измерения — через ИЛИ, между измерениями — И', async () => {
    w = await opsWorld();
    const bare = await op({ type: 'income', paidAt: '2026-10-02T10:00:00Z' }); // одна строка без статьи и проекта, без контрагента
    const full = await op({ paidAt: '2026-10-02T11:00:00Z', counterpartyId: w.counterparty, lines: [{ categoryId: w.expense, projectId: w.project, amount: 1000 }] });
    const half = await op({
      paidAt: '2026-10-02T12:00:00Z',
      counterpartyId: w.counterparty,
      lines: [
        { categoryId: w.expense, projectId: w.project, amount: 500 },
        { projectId: w.project2, amount: 500 },
      ],
    });
    const trBare = await transfer('2026-10-02T13:00:00Z');
    await transfer('2026-10-02T14:00:00Z', { lines: [{ projectId: w.project, amount: 47512 }] });

    expect(await ids('withoutCategory=true')).toEqual([half, bare]);
    expect(await ids('withoutProject=1')).toEqual([trBare, bare]);
    expect(await ids('withoutCounterparty=true')).toEqual([bare]);
    expect(await ids(`categoryIds=${w.expense}&withoutCategory=true`)).toEqual([half, full, bare]);
    expect(await ids('withoutCategory=true&withoutProject=true')).toEqual([bare]);
    expect(await ids('withoutCategory=false')).toHaveLength(5);
  });

  it('сортировка по сумме и курсор: страницы без пропусков и повторов при равных суммах; курсор другой сортировки или испорченный — 400 (Review Focus 3)', async () => {
    w = await opsWorld();
    const amounts = [3000, 1000, 3000, 2000, 3000, 1000, 5000];
    const made: { id: number; amount: number }[] = [];
    for (const [i, amount] of amounts.entries()) made.push({ id: await op({ paidAt: `2026-10-0${2 + (i % 3)}T1${i}:00:00Z`, amount }), amount });

    const walk = async (qs: string) => {
      const seen: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const p: Page = await page(`${qs}&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...p.items.map((i) => i.id));
        cursor = p.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      return { seen, pages };
    };
    const desc = [...made].sort((x, y) => y.amount - x.amount || y.id - x.id).map((x) => x.id);
    expect(await walk('sort=amount&order=desc')).toEqual({ seen: desc, pages: 4 });
    expect((await walk('sort=amount&order=asc')).seen).toEqual([...desc].reverse());
    expect((await walk('sort=date&order=desc')).seen).toEqual(await ids('limit=200'));

    const first = await page('sort=amount&limit=2');
    expect(fail(await get(`sort=date&limit=2&cursor=${first.nextCursor}`), 400, 'VALIDATION').fields).toEqual({
      cursor: 'Список изменился — загрузите его заново',
    });
    fail(await get('cursor=zzz'), 400, 'VALIDATION');
  });

  it('ошибки параметров — 400 с полем; чужая компания — 404; операции другой компании не видны даже по её счёту', async () => {
    w = await opsWorld();
    expect(fail(await get('limit=500'), 400, 'VALIDATION').fields).toEqual({ limit: 'От 1 до 200' });
    expect(fail(await get('from=2026-10-05&to=2026-10-01'), 400, 'VALIDATION').fields).toEqual({ to: 'Конец периода раньше начала' });
    expect(fail(await get('types=bogus'), 400, 'VALIDATION').fields).toEqual({ 'types.0': 'Неверный тип операции' });
    fail(await w.h.req('GET', '/api/v1/companies/999999/operations'), 404, 'NOT_FOUND');

    const other = await w.h.company('Другая');
    const acc = (await w.post(`/api/v1/companies/${other}/accounts`, { name: 'Чужая касса', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    await w.post(`/api/v1/companies/${other}/operations`, { type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: acc, amount: 100 });
    expect(await ids(`accountIds=${acc}`)).toEqual([]);
    expect(await ids()).toEqual([]);
  });
});
