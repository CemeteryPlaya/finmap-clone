import { afterEach, describe, expect, it } from 'vitest';
import { stockWorld, type StockWorld } from '../helpers/stock';

let w: StockWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

const D1 = '2026-10-01T10:00:00.000Z';
const D2 = '2026-10-02T10:00:00.000Z';
const D3 = '2026-10-03T10:00:00.000Z';
const R = 'Р';

async function world(): Promise<StockWorld> {
  w = await stockWorld('2026-10-06T12:00:00.000Z');
  return w;
}

const journal = (world: StockWorld, docId: number, body?: Record<string, unknown>) =>
  world.h.req('POST', `${world.stock}/docs/${docId}/journal`, body ?? { accountId: world.kzt, categoryId: world.income });
const getDoc = async (world: StockWorld, id: number) => (await world.h.req('GET', `${world.stock}/docs/${id}`)).json().doc;
const opCount = (world: StockWorld) => (world.h.t.sqlite.prepare('SELECT COUNT(*) n FROM operations').get() as { n: number }).n;

describe('продажа → доход журнала (§6.3)', () => {
  it('создаёт доход на выбранный счёт: сумма документа, категория, проект склада, поставщик-покупатель, комментарий «Продажа {номер}»', async () => {
    const w = await world();
    await w.receipt(D1, [[w.cola, 10_000, 100_000]]);
    const sale = await w.sale(D2, [[w.cola, 2000, 100_000], [w.chips, 1000, 70_000]], { counterpartyId: w.buyer });
    const res = await journal(w, sale.id);
    expect(res.statusCode).toBe(201);
    const { operationId, doc } = res.json();
    expect(doc.posting).toEqual({ operationId, amount: 170_000 });
    const op = (await w.h.req('GET', `${w.ops}/${operationId}`)).json().operation;
    expect(op).toMatchObject({
      type: 'income',
      status: 'actual',
      accountId: w.kzt,
      amount: 170_000,
      paidAt: D2,
      counterpartyId: w.buyer,
      comment: `Продажа ${R}-0001`,
      lines: [{ categoryId: w.income, projectId: w.project, amount: 170_000 }],
    });
    // деньги пришли на счёт; склад в «Всего на счетах» по-прежнему не входит
    const balances = (await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`)).json();
    expect(balances.accounts.find((a: any) => a.accountId === w.kzt).balance).toBe(170_000);
    expect(balances.total.amount).toBe(170_000);
    expect((await w.h.req('GET', `${w.stock}/docs`)).json().docs[0]).toMatchObject({ id: sale.id, posted: true });
    // себестоимость расходом в журнал не попадает
    expect(opCount(w)).toBe(1);
  });

  it('повтор невозможен; после удаления операции продажу можно провести снова', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const first = (await journal(w, sale.id)).json();
    const again = await journal(w, sale.id);
    expect([again.statusCode, again.json().error.code, again.json().error.message]).toEqual([422, 'ALREADY_POSTED', 'Продажа уже проведена в журнал']);
    expect(opCount(w)).toBe(1);

    await w.h.req('DELETE', `${w.ops}/${first.operationId}`);
    expect((await getDoc(w, sale.id)).posting).toBeNull();
    expect((await w.h.req('GET', `${w.stock}/docs`)).json().docs[0].posted).toBe(false);
    const second = await journal(w, sale.id);
    expect(second.statusCode).toBe(201);
    expect(second.json().operationId).not.toBe(first.operationId);
    expect((await getDoc(w, sale.id)).posting).toMatchObject({ operationId: second.json().operationId });
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_doc_postings').get()).toEqual({ n: 1 });
  });

  it('правка продажи операцию не меняет: в документе видно две суммы', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const { operationId } = (await journal(w, sale.id)).json();
    await w.h.req('PATCH', `${w.stock}/docs/${sale.id}`, { version: 1, lines: [{ itemId: w.cola, qty: 1000, amount: 60_000 }] });
    const doc = await getDoc(w, sale.id);
    expect([doc.total, doc.posting.amount]).toEqual([60_000, 50_000]);
    expect((await w.h.req('GET', `${w.ops}/${operationId}`)).json().operation.amount).toBe(50_000);
    // удаление проведённой продажи оставляет доход в журнале: деньги получены
    await w.h.req('DELETE', `${w.stock}/docs/${sale.id}`);
    expect((await w.h.req('GET', `${w.ops}/${operationId}`)).json().operation.deletedAt).toBeNull();
  });

  it('склад запоминает счёт и категорию прошлого проведения', async () => {
    const w = await world();
    const cat2 = (await w.post(`/api/v1/companies/${w.cid}/categories`, { kind: 'income', name: 'Продажа товаров' })).category.id as number;
    const s1 = await w.sale(D1, [[w.cola, 1000, 50_000]]);
    const s2 = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    expect((await getDoc(w, s1.id)).lastPost).toBeNull();
    await journal(w, s1.id, { accountId: w.kzt, categoryId: cat2 });
    expect((await getDoc(w, s2.id)).lastPost).toEqual({ accountId: w.kzt, categoryId: cat2 });
    // у другого склада памяти нет
    const other = await w.doc({ type: 'sale', at: D3, warehouseId: w.wh2, lines: [{ itemId: w.cola, qty: 1000, amount: 1 }] });
    expect((await getDoc(w, other.id)).lastPost).toBeNull();
    // у не-продажи поля нет
    expect((await getDoc(w, (await w.receipt(D1, [[w.cola, 1000, 1]])).id)).lastPost).toBeNull();
  });

  it('покупатель в архиве: операция создаётся без контрагента (R6)', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]], { counterpartyId: w.buyer });
    await w.h.req('POST', `/api/v1/companies/${w.cid}/counterparties/${w.buyer}/archive`);
    const res = await journal(w, sale.id);
    expect(res.statusCode).toBe(201);
    const op = (await w.h.req('GET', `${w.ops}/${res.json().operationId}`)).json().operation;
    expect(op.counterpartyId).toBeNull();
    expect(op.amount).toBe(50_000);
  });
});

describe('правила проведения и откат', () => {
  it('только продажа; нулевая сумма и продажа из Senet — 422; чужой документ — 404', async () => {
    const w = await world();
    const r = await w.receipt(D1, [[w.cola, 1000, 100]]);
    const o = await w.writeoff(D1, [[w.cola, 1000]]);
    const free = await w.sale(D1, [[w.chips, 1000, 0]]);
    const fromSenet = await w.sale(D1, [[w.chips, 1000, 100]]);
    w.h.t.sqlite.prepare("UPDATE stock_docs SET source = 'senet', source_ref = 'смена-1' WHERE id = ?").run(fromSenet.id);
    const msg = async (id: number) => (await journal(w, id)).json().error.message;
    expect(await msg(r.id)).toBe('В журнал проводится только продажа');
    expect(await msg(o.id)).toBe('В журнал проводится только продажа');
    expect(await msg(free.id)).toBe('Сумма продажи равна нулю — проводить нечего');
    expect(await msg(fromSenet.id)).toBe('Выручка бара проводится из смены в «Сверке Senet»');
    expect((await journal(w, 99_999)).statusCode).toBe(404);
    expect(opCount(w)).toBe(0);
  });

  it('ошибка операции журнала откатывает проведение целиком: операции и связи нет', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const wrongKind = await journal(w, sale.id, { accountId: w.kzt, categoryId: w.expense });
    expect([wrongKind.statusCode, wrongKind.json().error.code]).toEqual([422, 'INVARIANT_3']);
    const spare = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Запасная', currency: 'KZT', openedAt: '2026-10-01', startingBalance: 0 })).account.id as number;
    await w.h.req('POST', `/api/v1/companies/${w.cid}/accounts/${spare}/archive`);
    const archived = await journal(w, sale.id, { accountId: spare, categoryId: w.income });
    expect([archived.statusCode, archived.json().error.code]).toEqual([422, 'ARCHIVED_REFERENCE']);
    const early = await w.sale('2026-09-20T10:00:00.000Z', [[w.cola, 1000, 50_000]]); // раньше открытия счёта 2026-10-01
    const tooEarly = await journal(w, early.id);
    expect([tooEarly.statusCode, tooEarly.json().error.code]).toEqual([422, 'INVARIANT_6']);
    expect(opCount(w)).toBe(0);
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_doc_postings').get()).toEqual({ n: 0 });
    expect((await getDoc(w, sale.id)).posting).toBeNull();
  });

  it('счёт в другой валюте или чужой компании отклоняется: сумма документа — в валюте компании', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const usd = await journal(w, sale.id, { accountId: w.usd, categoryId: w.income });
    expect([usd.statusCode, usd.json().error.code, usd.json().error.message]).toEqual([422, 'VALIDATION', 'Выручка проводится на счёт в валюте компании (KZT)']);
    const missing = await journal(w, sale.id, { accountId: 99_999, categoryId: w.income });
    expect([missing.statusCode, missing.json().error.code]).toEqual([422, 'INVARIANT_5']);
    expect(opCount(w)).toBe(0);
  });

  it('архивная компания: проведение запрещено; поля тела обязательны', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    expect((await journal(w, sale.id, { accountId: w.kzt })).statusCode).toBe(400);
    w.h.t.sqlite.prepare("UPDATE companies SET archived_at = '2026-10-06T00:00:00.000Z' WHERE id = ?").run(w.cid);
    const res = await journal(w, sale.id);
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'ARCHIVED_REFERENCE']);
    expect(opCount(w)).toBe(0);
  });

  it('история: проведение записывается у документа, создание операции — у операции', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    await journal(w, sale.id);
    expect(w.h.auditCount('operation', 'create')).toBe(1);
    expect(w.h.auditCount('stock_doc', 'update')).toBe(1);
  });
});

describe('проект склада в архиве (R13)', () => {
  it('проведение продажи склада с архивным проектом — понятный 422 до создания операции', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    w.h.t.sqlite.prepare("UPDATE projects SET archived_at = '2026-10-06T00:00:00.000Z' WHERE id = ?").run(w.project);
    const res = await journal(w, sale.id);
    expect([res.statusCode, res.json().error.code, res.json().error.message]).toEqual([
      422,
      'ARCHIVED_REFERENCE',
      'Проект склада в архиве — верните проект из архива, чтобы провести продажу',
    ]);
    expect(opCount(w)).toBe(0);
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_doc_postings').get()).toEqual({ n: 0 });
  });
});

describe('защита проведения (R15)', () => {
  it('второе проведение через другой путь — отказ; первичный ключ doc_id не даёт вставить вторую связь', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const first = (await journal(w, sale.id)).json();
    // «другой путь»: запрос с другим счётом и категорией после перечитывания документа
    expect((await getDoc(w, sale.id)).posting).toEqual({ operationId: first.operationId, amount: 50_000 });
    const again = await journal(w, sale.id, { accountId: w.kzt, categoryId: w.income });
    expect([again.statusCode, again.json().error.code]).toEqual([422, 'ALREADY_POSTED']);
    expect(opCount(w)).toBe(1);
    // на уровне БД вторая связь с тем же документом невозможна
    const spareOp = w.h.t.sqlite.prepare('SELECT id FROM operations LIMIT 1').get() as { id: number };
    expect(() => w.h.t.sqlite.prepare('INSERT INTO stock_doc_postings (doc_id, operation_id) VALUES (?, ?)').run(sale.id, spareOp.id)).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_doc_postings').get()).toEqual({ n: 1 });
  });

  it('жёсткое удаление операции проведения убирает строку stock_doc_postings (каскад), продажу можно провести снова', async () => {
    const w = await world();
    const sale = await w.sale(D2, [[w.cola, 1000, 50_000]]);
    const { operationId } = (await journal(w, sale.id)).json();
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_doc_postings').get()).toEqual({ n: 1 });
    w.h.t.sqlite.prepare('DELETE FROM operation_lines WHERE operation_id = ?').run(operationId);
    w.h.t.sqlite.prepare('DELETE FROM operations WHERE id = ?').run(operationId);
    expect(w.h.t.sqlite.prepare('SELECT COUNT(*) n FROM stock_doc_postings').get()).toEqual({ n: 0 });
    expect((await getDoc(w, sale.id)).posting).toBeNull();
    expect((await journal(w, sale.id)).statusCode).toBe(201);
  });
});
