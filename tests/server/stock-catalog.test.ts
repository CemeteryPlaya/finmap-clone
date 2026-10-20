import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld | null = null;
afterEach(async () => {
  await w?.h.t.cleanup();
  w = null;
});

const NOW = '2026-10-06T12:00:00.000Z'; // 17:00 по Алматы, сегодня 2026-10-06

async function setup(): Promise<{ w: OpsWorld; stock: string }> {
  w = await opsWorld(NOW);
  return { w, stock: `/api/v1/companies/${w.cid}/stock` };
}

describe('группы товаров', () => {
  it('создание, переименование, архив; название уникально без учёта регистра и «ё»', async () => {
    const { w, stock } = await setup();
    const g = (await w.post(`${stock}/groups`, { name: ' Напитки ' })).group;
    expect(g).toMatchObject({ name: 'Напитки', archivedAt: null });
    const dup = await w.h.req('POST', `${stock}/groups`, { name: 'НАПИТКИ' });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.fields.name).toBe('Такая группа уже есть');
    const renamed = await w.h.req('PATCH', `${stock}/groups/${g.id}`, { name: 'Еда' });
    expect(renamed.json().group.name).toBe('Еда');
    expect((await w.h.req('POST', `${stock}/groups/${g.id}/archive`)).json().group.archivedAt).not.toBeNull();
    const again = await w.h.req('POST', `${stock}/groups`, { name: 'еда' });
    expect(again.statusCode).toBe(422);
    expect(again.json().error.code).toBe('ARCHIVED_DUPLICATE');
    expect((await w.h.req('POST', `${stock}/groups/${g.id}/unarchive`)).json().group.archivedAt).toBeNull();
    expect((await w.h.req('GET', `${stock}/groups`)).json().groups).toHaveLength(1);
    expect(await w.h.auditCount('stock_group')).toBe(4);
  });
});

describe('товары', () => {
  it('создание: название очищается, цена продажи пишет первую строку истории с сегодняшней датой', async () => {
    const { w, stock } = await setup();
    const res = await w.h.req('POST', `${stock}/items`, { name: '  Кола   0,5 ', unit: 'pcs', salePrice: 50000, barcode: ' 4870000000011 ', minQty: 5000 });
    expect(res.statusCode).toBe(201);
    const item = res.json().item;
    expect(item).toMatchObject({ name: 'Кола 0,5', unit: 'pcs', salePrice: 50000, barcode: '4870000000011', minQty: 5000, isCombo: false, archivedAt: null });
    expect(item.prices).toEqual([{ price: 50000, validFrom: '2026-10-06' }]);
    const free = (await w.post(`${stock}/items`, { name: 'Чипсы', unit: 'pcs' })).item;
    expect(free).toMatchObject({ salePrice: 0, prices: [], barcode: null, minQty: null, groupId: null });
  });

  it('название уникально в компании; архивный дубль предлагает вернуть из архива', async () => {
    const { w, stock } = await setup();
    const a = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs' })).item;
    const dup = await w.h.req('POST', `${stock}/items`, { name: 'кола 0,5', unit: 'pcs' });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.fields.name).toBe('Такой товар уже есть');
    await w.h.req('POST', `${stock}/items/${a.id}/archive`);
    const arch = await w.h.req('POST', `${stock}/items`, { name: 'Кола 0,5', unit: 'l' });
    expect(arch.statusCode).toBe(422);
    expect(arch.json().error.code).toBe('ARCHIVED_DUPLICATE');
  });

  it('проверки полей: единица, цена, минимальный остаток, группа чужой компании', async () => {
    const { w, stock } = await setup();
    const bad = await w.h.req('POST', `${stock}/items`, { name: 'X', unit: 'box', salePrice: -1, minQty: 0 });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().error.fields).sort()).toEqual(['minQty', 'salePrice', 'unit']);
    const other = (await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Другое' })).json().company.id as number;
    const foreign = (await w.post(`/api/v1/companies/${other}/stock/groups`, { name: 'Чужая' })).group.id as number;
    const res = await w.h.req('POST', `${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', groupId: foreign });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVARIANT_5');
    expect((await w.h.req('GET', `/api/v1/companies/${other}/stock/items/${(await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs' })).item.id}`)).statusCode).toBe(404);
  });

  it('PATCH: название, группа, штрихкод, минимальный остаток; архивную группу можно только оставить', async () => {
    const { w, stock } = await setup();
    const g1 = (await w.post(`${stock}/groups`, { name: 'Напитки' })).group.id as number;
    const g2 = (await w.post(`${stock}/groups`, { name: 'Еда' })).group.id as number;
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', groupId: g1 })).item;
    const res = await w.h.req('PATCH', `${stock}/items/${item.id}`, { name: 'Кола 0,33', groupId: g2, barcode: '1', minQty: 3000 });
    expect(res.json().item).toMatchObject({ name: 'Кола 0,33', groupId: g2, barcode: '1', minQty: 3000 });
    await w.h.req('POST', `${stock}/groups/${g2}/archive`);
    expect((await w.h.req('PATCH', `${stock}/items/${item.id}`, { groupId: g2, barcode: '2' })).statusCode).toBe(200); // та же группа
    const moved = await w.h.req('PATCH', `${stock}/items/${item.id}`, { groupId: g1 });
    expect(moved.statusCode).toBe(200);
    const back = await w.h.req('PATCH', `${stock}/items/${item.id}`, { groupId: g2 });
    expect(back.statusCode).toBe(422);
    expect(back.json().error.code).toBe('ARCHIVED_REFERENCE');
    const noop = await w.h.auditCount('stock_item', 'update');
    await w.h.req('PATCH', `${stock}/items/${item.id}`, { name: 'Кола 0,33' });
    expect(await w.h.auditCount('stock_item', 'update')).toBe(noop); // без изменений история не пишется
  });

  it('удаление: товар без документов удаляется, архив и возврат работают', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 100 })).item;
    expect((await w.h.req('POST', `${stock}/items/${item.id}/archive`)).json().item.archivedAt).not.toBeNull();
    expect((await w.h.req('POST', `${stock}/items/${item.id}/unarchive`)).json().item.archivedAt).toBeNull();
    expect((await w.h.req('DELETE', `${stock}/items/${item.id}`)).statusCode).toBe(204);
    expect((await w.h.req('GET', `${stock}/items/${item.id}`)).statusCode).toBe(404);
    expect((await w.h.t.q('SELECT COUNT(*) n FROM stock_item_prices'))[0]).toEqual({ n: 0 });
  });
});

describe('история цены продажи (§3.1)', () => {
  it('новая цена с сегодняшней даты меняет текущую; на ту же дату — заменяет строку', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50000 })).item;
    let res = await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 60000, validFrom: '2026-10-06' });
    expect(res.json().item).toMatchObject({ salePrice: 60000, prices: [{ price: 60000, validFrom: '2026-10-06' }] });
    res = await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 65000, validFrom: '2026-10-06' });
    expect(res.json().item.prices).toEqual([{ price: 65000, validFrom: '2026-10-06' }]);
    expect(res.json().item.salePrice).toBe(65000);
  });

  it('цена задним числом остаётся в истории, текущая цена не меняется', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50000 })).item;
    const res = await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 40000, validFrom: '2026-09-01' });
    expect(res.json().item.salePrice).toBe(50000);
    expect(res.json().item.prices).toEqual([
      { price: 40000, validFrom: '2026-09-01' },
      { price: 50000, validFrom: '2026-10-06' },
    ]);
  });

  it('дата в будущем и неверная дата отклоняются; архивный товар — 422', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50000 })).item;
    const future = await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 1, validFrom: '2026-10-07' });
    expect(future.statusCode).toBe(400);
    expect(future.json().error.fields.validFrom).toBe('Дата начала не может быть в будущем');
    expect((await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 1, validFrom: '2026-02-30' })).statusCode).toBe(400);
    await w.h.req('POST', `${stock}/items/${item.id}/archive`);
    expect((await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 1, validFrom: '2026-10-06' })).json().error.code).toBe('ARCHIVED_REFERENCE');
  });

  it('вторая такая же цена на ту же дату ничего не пишет', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50000 })).item;
    const before = await w.h.auditCount('stock_item', 'update');
    await w.h.req('POST', `${stock}/items/${item.id}/price`, { price: 50000, validFrom: '2026-10-06' });
    expect(await w.h.auditCount('stock_item', 'update')).toBe(before);
  });
});

describe('архивная компания', () => {
  it('чтение разрешено, любая запись — 422 ARCHIVED_REFERENCE', async () => {
    const { w, stock } = await setup();
    const item = (await w.post(`${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50000 })).item;
    const group = (await w.post(`${stock}/groups`, { name: 'Напитки' })).group;
    await w.h.t.q("UPDATE companies SET archived_at = '2026-10-06T00:00:00.000Z' WHERE id = ?", w.cid);
    expect((await w.h.req('GET', `${stock}/items`)).statusCode).toBe(200);
    const writes: [string, string, unknown][] = [
      ['POST', `${stock}/items`, { name: 'Чипсы', unit: 'pcs' }],
      ['PATCH', `${stock}/items/${item.id}`, { barcode: '1' }],
      ['POST', `${stock}/items/${item.id}/price`, { price: 1, validFrom: '2026-10-06' }],
      ['POST', `${stock}/items/${item.id}/archive`, undefined],
      ['DELETE', `${stock}/items/${item.id}`, undefined],
      ['POST', `${stock}/groups`, { name: 'Еда' }],
      ['PATCH', `${stock}/groups/${group.id}`, { name: 'Еда' }],
      ['POST', `${stock}/warehouses`, { projectId: w.project, name: 'Бар' }],
    ];
    for (const [method, url, body] of writes) {
      const res = await w.h.req(method as 'POST', url, body);
      expect([res.statusCode, res.json().error.code], `${method} ${url}`).toEqual([422, 'ARCHIVED_REFERENCE']);
    }
  });
});

describe('порог «Мало» и единица (R14)', () => {
  it('у «шт» и «уп» порог целый, у «л» дробный допустим; правка порога и единицы проверяется так же', async () => {
    const { w, stock } = await setup();
    const bad = await w.h.req('POST', `${stock}/items`, { name: 'Кола 0,5', unit: 'pcs', minQty: 1500 });
    expect([bad.statusCode, bad.json().error.fields.minQty]).toEqual([400, 'Количество в штуках — целое']);
    const pack = await w.h.req('POST', `${stock}/items`, { name: 'Чипсы', unit: 'pack', minQty: 2500 });
    expect([pack.statusCode, pack.json().error.fields.minQty]).toEqual([400, 'Количество в штуках — целое']);
    const syrup = await w.h.req('POST', `${stock}/items`, { name: 'Сироп', unit: 'l', minQty: 1500 });
    expect([syrup.statusCode, syrup.json().item.minQty]).toEqual([201, 1500]);
    const cola = (await w.post(`${stock}/items`, { name: 'Кола', unit: 'pcs', minQty: 2000 })).item;
    const patchBad = await w.h.req('PATCH', `${stock}/items/${cola.id}`, { minQty: 2500 });
    expect([patchBad.statusCode, patchBad.json().error.fields.minQty]).toEqual([400, 'Количество в штуках — целое']);
    // смена единицы на «шт» при дробном пороге тоже отклоняется
    const toPcs = await w.h.req('PATCH', `${stock}/items/${syrup.json().item.id}`, { unit: 'pcs' });
    expect([toPcs.statusCode, toPcs.json().error.fields.minQty]).toEqual([400, 'Количество в штуках — целое']);
    const fine = await w.h.req('PATCH', `${stock}/items/${cola.id}`, { minQty: 3000 });
    expect([fine.statusCode, fine.json().item.minQty]).toEqual([200, 3000]);
  });
});
