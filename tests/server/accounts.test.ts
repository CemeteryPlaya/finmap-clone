import { afterEach, describe, expect, it } from 'vitest';
import { companies, projects } from '../../src/server/db/schema';
import { seedCurrencies } from '../../src/server/db/seed';
import { AppError } from '../../src/server/errors';
import { createAccountsService } from '../../src/server/modules/accounts/service';
import { createAuditService } from '../../src/server/modules/audit/service';
import type { BalancesService } from '../../src/server/modules/balances/service';
import type { ReferencesService } from '../../src/server/modules/references/service';
import { createTestDb, type TestDb } from '../helpers/test-db';

let t: TestDb;
afterEach(() => t?.cleanup());

async function setup() {
  t = await createTestDb();
  await seedCurrencies(t.db);
  const c1 = (await t.db.insert(companies).values({ name: 'A', baseCurrency: 'KZT', createdAt: 'x' }).returning())[0]!;
  const c2 = (await t.db.insert(companies).values({ name: 'B', baseCurrency: 'KZT', createdAt: 'x' }).returning())[0]!;
  const svc = createAccountsService({
    db: t.db,
    audit: createAuditService(t.db),
    timezone: 'Asia/Almaty',
    now: () => new Date('2026-10-06T00:00:00.000Z'),
  });
  return { svc, c1: c1.id, c2: c2.id };
}

describe('accounts', () => {
  it('создаёт счета по порядку и отдаёт только счета своей компании', async () => {
    const { svc, c1, c2 } = await setup();
    const a = await svc.create(t.db, { companyId: c1, name: ' Касса ', currency: 'KZT', openedAt: '2026-10-06' });
    await svc.create(t.db, { companyId: c1, name: 'USD', currency: 'USD', openedAt: '2026-10-06', startingBalance: 1000 });
    await svc.create(t.db, { companyId: c2, name: 'Чужой', currency: 'KZT', openedAt: '2026-10-06' });
    expect(a).toMatchObject({ name: 'Касса', startingBalance: 0, orderIndex: 0, projectId: null, archivedAt: null });
    expect((await svc.list(c1)).map((x) => [x.name, x.orderIndex, x.startingBalance])).toEqual([
      ['Касса', 0, 0],
      ['USD', 1, 1000],
    ]);
  });

  it('отклоняет неизвестную валюту, пустое имя, дробный баланс, кривую дату и чужой проект', async () => {
    const { svc, c1, c2 } = await setup();
    const fieldsOf = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        return Object.keys((e as { fields?: Record<string, string> }).fields ?? {});
      }
      throw new Error('ожидалась ошибка');
    };
    expect(await fieldsOf(() => svc.create(t.db, { companyId: c1, name: 'X', currency: 'XXX', openedAt: '2026-10-06' }))).toEqual(['currency']);
    expect(await fieldsOf(() => svc.create(t.db, { companyId: c1, name: '  ', currency: 'KZT', openedAt: '2026-10-06' }))).toEqual(['name']);
    expect(
      await fieldsOf(() => svc.create(t.db, { companyId: c1, name: 'X', currency: 'KZT', openedAt: '2026-10-06', startingBalance: 1.5 })),
    ).toEqual(['startingBalance']);
    expect(await fieldsOf(() => svc.create(t.db, { companyId: c1, name: 'X', currency: 'KZT', openedAt: '06.10.2026' }))).toEqual(['openedAt']);
    expect(await fieldsOf(() => svc.create(t.db, { companyId: c1, name: 'X', currency: 'KZT', openedAt: '2026-02-31' }))).toEqual(['openedAt']);
    const foreignProject = (await t.db
      .insert(projects)
      .values({ companyId: c2, name: 'Чужой', templateKey: 'general', templateParams: '{}', orderIndex: 0, createdAt: 'x' }).returning())[0]!;
    expect(
      await fieldsOf(() => svc.create(t.db, { companyId: c1, projectId: foreignProject.id, name: 'X', currency: 'KZT', openedAt: '2026-10-06' })),
    ).toEqual(['projectId']);
  });

  it('countActive считает неархивные счета компании и отдельно проекта', async () => {
    const { svc, c1 } = await setup();
    const p = (await t.db
      .insert(projects)
      .values({ companyId: c1, name: 'Клуб', templateKey: 'general', templateParams: '{}', orderIndex: 0, createdAt: 'x' }).returning())[0]!;
    await svc.create(t.db, { companyId: c1, name: 'A', currency: 'KZT', openedAt: '2026-10-06' });
    await svc.create(t.db, { companyId: c1, projectId: p.id, name: 'P1', currency: 'KZT', openedAt: '2026-10-06' });
    const b = await svc.create(t.db, { companyId: c1, projectId: p.id, name: 'P2', currency: 'KZT', openedAt: '2026-10-06' });
    await t.q('UPDATE accounts SET archived_at = ? WHERE id = ?', 'x', b.id);
    expect(await svc.countActive(c1)).toBe(2);
    expect(await svc.countActive(c1, p.id)).toBe(1);
  });
});

describe('accounts: ссылки операций и баланс (заглушки шага 4 подменяются)', () => {
  it('удаление, смена валюты, сдвиг openedAt и архив учитывают операции и баланс', async () => {
    t = await createTestDb();
    await seedCurrencies(t.db);
    const company = (await t.db.insert(companies).values({ name: 'A', baseCurrency: 'KZT', createdAt: 'x' }).returning())[0]!;
    const references: ReferencesService = { countOperations: async () => 1, earliestOperationDate: async () => '2026-10-01' };
    const balances: BalancesService = { accountBalance: async () => 500 };
    const svc = createAccountsService({ db: t.db, audit: createAuditService(t.db), references, balances, timezone: 'Asia/Almaty' });
    const acc = await svc.add(company.id, { name: 'Касса', currency: 'KZT', openedAt: '2026-09-01' }, 1);
    const code = async (fn: () => Promise<unknown>): Promise<string> => {
      try {
        await fn();
        return 'OK';
      } catch (e) {
        return (e as AppError).code;
      }
    };
    expect(await code(() => svc.remove(company.id, acc.id, 1))).toBe('INVARIANT_9');
    expect(await code(() => svc.update(company.id, acc.id, { currency: 'USD' }, 1))).toBe('CURRENCY_LOCKED');
    expect(await code(() => svc.update(company.id, acc.id, { openedAt: '2026-10-02' }, 1))).toBe('INVARIANT_6');
    expect(await code(() => svc.update(company.id, acc.id, { openedAt: '2026-10-01' }, 1))).toBe('OK');
    expect(await code(() => svc.archive(company.id, acc.id, 1))).toBe('ARCHIVED_REFERENCE');
  });
});
