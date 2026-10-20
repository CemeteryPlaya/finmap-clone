import { afterEach, describe, expect, it } from 'vitest';
import { companies } from '../../src/server/db/schema';
import { seedCurrencies } from '../../src/server/db/seed';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { getTemplate } from '../../src/templates';
import { createTestDb, type TestDb } from '../helpers/test-db';

let t: TestDb;
afterEach(() => t?.cleanup());

async function setup() {
  t = await createTestDb();
  await seedCurrencies(t.db);
  const company = (await t.db.insert(companies).values({ name: 'ТОО', baseCurrency: 'KZT', createdAt: 'x' }).returning())[0]!;
  const svc = createCategoriesService({ db: t.db, audit: createAuditService(t.db), now: () => new Date('2026-10-06T00:00:00.000Z') });
  return { svc, companyId: company.id };
}

describe('categories', () => {
  it('seedSystem создаёт 9 системных категорий верхнего уровня', async () => {
    const { svc, companyId } = await setup();
    await svc.seedSystem(t.db, companyId);
    const tree = await svc.listTree(companyId);
    expect(tree.income.map((c) => c.name)).toEqual(['Инвестиции', 'Возврат займа', 'Получение кредита']);
    expect(tree.expense.map((c) => c.systemKey)).toEqual(['salary', 'tax', 'vat', 'dividends', 'credit_repayment', 'loan_issued']);
    expect(tree.expense.every((c) => c.parentId === null && c.effectiveSystemKey === c.systemKey)).toBe(true);
  });

  it('mergeTemplate кладёт детей underSystem под системную категорию и наследует systemKey', async () => {
    const { svc, companyId } = await setup();
    await svc.seedSystem(t.db, companyId);
    const created = await svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!);
    expect(created).toBeGreaterThan(20);
    const salary = (await svc.listTree(companyId)).expense.find((c) => c.systemKey === 'salary')!;
    expect(salary.children.map((c) => c.name)).toEqual(['Администраторы', 'Премии']);
    expect(salary.children.every((c) => c.systemKey === null && c.effectiveSystemKey === 'salary')).toBe(true);
    const premises = (await svc.listTree(companyId)).expense.find((c) => c.templateRef === 'computer-club:premises')!;
    expect(premises.children.map((c) => c.name)).toEqual(['Аренда', 'Коммунальные услуги', 'Электроэнергия', 'Интернет']);
    expect(premises.effectiveSystemKey).toBeNull();
  });

  it('mergeTemplate идемпотентен', async () => {
    const { svc, companyId } = await setup();
    await svc.seedSystem(t.db, companyId);
    await svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!);
    const before = JSON.stringify(await svc.listTree(companyId));
    expect(await svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!)).toBe(0);
    expect(JSON.stringify(await svc.listTree(companyId))).toBe(before);
  });

  it('mergeTemplate не трогает переименованные и архивные категории шаблона (Review Focus 2)', async () => {
    const { svc, companyId } = await setup();
    await svc.seedSystem(t.db, companyId);
    await svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!);
    await t.q("UPDATE categories SET name = 'Аренда зала' WHERE template_ref = 'computer-club:rent'");
    await t.q("UPDATE categories SET archived_at = 'x' WHERE template_ref = 'computer-club:charity'");
    expect(await svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!)).toBe(0);
    const rows = (await t.q("SELECT name, archived_at FROM categories WHERE template_ref IN ('computer-club:rent','computer-club:charity') ORDER BY template_ref")) as { name: string; archived_at: string | null }[];
    expect(rows).toEqual([
      { name: 'Благотворительность', archived_at: 'x' },
      { name: 'Аренда зала', archived_at: null },
    ]);
  });

  it('mergeTemplate без системных категорий падает понятной ошибкой', async () => {
    const { svc, companyId } = await setup();
    await expect(svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!)).rejects.toThrow(/salary/);
  });

  it.each(['moved', 'archived'] as const)(
    'mergeTemplate: группа шаблона %s — новые дочерние встают на верхний уровень (Review Focus 3)',
    async (variant) => {
      const { svc, companyId } = await setup();
      const club = getTemplate('computer-club')!;
      await svc.seedSystem(t.db, companyId);
      await svc.mergeTemplate(t.db, companyId, club);
      const premises = (await t.q("SELECT id FROM categories WHERE template_ref = 'computer-club:premises'"))[0] as { id: number };
      // пользователь убрал дочерние «Помещения», затем перенёс группу в свою или отправил в архив
      await t.q('DELETE FROM categories WHERE parent_id = ?', premises.id);
      if (variant === 'moved') {
        const mine = await svc.add(companyId, { kind: 'expense', name: 'Моя группа', parentId: null }, 1);
        await t.q('UPDATE categories SET parent_id = ? WHERE id = ?', mine.id, premises.id);
      } else {
        await t.q("UPDATE categories SET archived_at = 'x' WHERE id = ?", premises.id);
      }
      expect(await svc.mergeTemplate(t.db, companyId, club)).toBe(4);
      const depth3 = (await t.q('SELECT COUNT(*) n FROM categories c JOIN categories p ON p.id = c.parent_id WHERE p.parent_id IS NOT NULL'))[0] as { n: number };
      expect(depth3.n).toBe(0);
      const underPremises = (await t.q('SELECT COUNT(*) n FROM categories WHERE parent_id = ?', premises.id))[0] as { n: number };
      expect(underPremises.n).toBe(0);
      const rent = (await t.q("SELECT parent_id FROM categories WHERE template_ref = 'computer-club:rent'"))[0] as { parent_id: number | null };
      expect(rent.parent_id).toBeNull();
    },
  );
});
