import { afterEach, describe, expect, it } from 'vitest';
import { companies, projects } from '../../src/server/db/schema';
import { seedCurrencies } from '../../src/server/db/seed';
import { createAccountsService } from '../../src/server/modules/accounts/service';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

function setup() {
  t = createTestDb();
  seedCurrencies(t.db);
  const c1 = t.db.insert(companies).values({ name: 'A', baseCurrency: 'KZT', createdAt: 'x' }).returning().get();
  const c2 = t.db.insert(companies).values({ name: 'B', baseCurrency: 'KZT', createdAt: 'x' }).returning().get();
  return { svc: createAccountsService(t.db, () => new Date('2026-10-06T00:00:00.000Z')), c1: c1.id, c2: c2.id };
}

describe('accounts', () => {
  it('создаёт счета по порядку и отдаёт только счета своей компании', () => {
    const { svc, c1, c2 } = setup();
    const a = svc.create(t.db, { companyId: c1, name: ' Касса ', currency: 'KZT', openedAt: '2026-10-06' });
    svc.create(t.db, { companyId: c1, name: 'USD', currency: 'USD', openedAt: '2026-10-06', startingBalance: 1000 });
    svc.create(t.db, { companyId: c2, name: 'Чужой', currency: 'KZT', openedAt: '2026-10-06' });
    expect(a).toMatchObject({ name: 'Касса', startingBalance: 0, orderIndex: 0, projectId: null, archivedAt: null });
    expect(svc.list(c1).map((x) => [x.name, x.orderIndex, x.startingBalance])).toEqual([
      ['Касса', 0, 0],
      ['USD', 1, 1000],
    ]);
  });

  it('отклоняет неизвестную валюту, пустое имя, дробный баланс, кривую дату и чужой проект', () => {
    const { svc, c1, c2 } = setup();
    const fieldsOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return Object.keys((e as { fields?: Record<string, string> }).fields ?? {});
      }
      throw new Error('ожидалась ошибка');
    };
    expect(fieldsOf(() => svc.create(t.db, { companyId: c1, name: 'X', currency: 'XXX', openedAt: '2026-10-06' }))).toEqual(['currency']);
    expect(fieldsOf(() => svc.create(t.db, { companyId: c1, name: '  ', currency: 'KZT', openedAt: '2026-10-06' }))).toEqual(['name']);
    expect(
      fieldsOf(() => svc.create(t.db, { companyId: c1, name: 'X', currency: 'KZT', openedAt: '2026-10-06', startingBalance: 1.5 })),
    ).toEqual(['startingBalance']);
    expect(fieldsOf(() => svc.create(t.db, { companyId: c1, name: 'X', currency: 'KZT', openedAt: '06.10.2026' }))).toEqual(['openedAt']);
    const foreignProject = t.db
      .insert(projects)
      .values({ companyId: c2, name: 'Чужой', templateKey: 'general', templateParams: '{}', orderIndex: 0, createdAt: 'x' })
      .returning()
      .get();
    expect(
      fieldsOf(() => svc.create(t.db, { companyId: c1, projectId: foreignProject.id, name: 'X', currency: 'KZT', openedAt: '2026-10-06' })),
    ).toEqual(['projectId']);
  });

  it('countActive считает неархивные счета компании и отдельно проекта', () => {
    const { svc, c1 } = setup();
    const p = t.db
      .insert(projects)
      .values({ companyId: c1, name: 'Клуб', templateKey: 'general', templateParams: '{}', orderIndex: 0, createdAt: 'x' })
      .returning()
      .get();
    svc.create(t.db, { companyId: c1, name: 'A', currency: 'KZT', openedAt: '2026-10-06' });
    svc.create(t.db, { companyId: c1, projectId: p.id, name: 'P1', currency: 'KZT', openedAt: '2026-10-06' });
    const b = svc.create(t.db, { companyId: c1, projectId: p.id, name: 'P2', currency: 'KZT', openedAt: '2026-10-06' });
    t.sqlite.prepare('UPDATE accounts SET archived_at = ? WHERE id = ?').run('x', b.id);
    expect(svc.countActive(c1)).toBe(2);
    expect(svc.countActive(c1, p.id)).toBe(1);
  });
});
