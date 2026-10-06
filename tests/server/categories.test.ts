import { afterEach, describe, expect, it } from 'vitest';
import { companies } from '../../src/server/db/schema';
import { seedCurrencies } from '../../src/server/db/seed';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { getTemplate } from '../../src/templates';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

function setup() {
  t = createTestDb();
  seedCurrencies(t.db);
  const company = t.db.insert(companies).values({ name: 'ТОО', baseCurrency: 'KZT', createdAt: 'x' }).returning().get();
  const svc = createCategoriesService(t.db, () => new Date('2026-10-06T00:00:00.000Z'));
  return { svc, companyId: company.id };
}

describe('categories', () => {
  it('seedSystem создаёт 9 системных статей верхнего уровня', () => {
    const { svc, companyId } = setup();
    svc.seedSystem(t.db, companyId);
    const tree = svc.listTree(companyId);
    expect(tree.income.map((c) => c.name)).toEqual(['Инвестиции', 'Возврат займа', 'Получение кредита']);
    expect(tree.expense.map((c) => c.systemKey)).toEqual(['salary', 'tax', 'vat', 'dividends', 'credit_repayment', 'loan_issued']);
    expect(tree.expense.every((c) => c.parentId === null && c.effectiveSystemKey === c.systemKey)).toBe(true);
  });

  it('mergeTemplate кладёт детей underSystem под системную статью и наследует systemKey', () => {
    const { svc, companyId } = setup();
    svc.seedSystem(t.db, companyId);
    const created = svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!);
    expect(created).toBeGreaterThan(20);
    const salary = svc.listTree(companyId).expense.find((c) => c.systemKey === 'salary')!;
    expect(salary.children.map((c) => c.name)).toEqual(['Администраторы', 'Премии']);
    expect(salary.children.every((c) => c.systemKey === null && c.effectiveSystemKey === 'salary')).toBe(true);
    const premises = svc.listTree(companyId).expense.find((c) => c.templateRef === 'computer-club:premises')!;
    expect(premises.children.map((c) => c.name)).toEqual(['Аренда', 'Коммунальные услуги', 'Электроэнергия', 'Интернет']);
    expect(premises.effectiveSystemKey).toBeNull();
  });

  it('mergeTemplate идемпотентен', () => {
    const { svc, companyId } = setup();
    svc.seedSystem(t.db, companyId);
    svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!);
    const before = JSON.stringify(svc.listTree(companyId));
    expect(svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!)).toBe(0);
    expect(JSON.stringify(svc.listTree(companyId))).toBe(before);
  });

  it('mergeTemplate не трогает переименованные и архивные статьи шаблона (Review Focus 2)', () => {
    const { svc, companyId } = setup();
    svc.seedSystem(t.db, companyId);
    svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!);
    t.sqlite.prepare("UPDATE categories SET name = 'Аренда зала' WHERE template_ref = 'computer-club:rent'").run();
    t.sqlite.prepare("UPDATE categories SET archived_at = 'x' WHERE template_ref = 'computer-club:charity'").run();
    expect(svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!)).toBe(0);
    const rows = t.sqlite
      .prepare("SELECT name, archived_at FROM categories WHERE template_ref IN ('computer-club:rent','computer-club:charity') ORDER BY template_ref")
      .all() as { name: string; archived_at: string | null }[];
    expect(rows).toEqual([
      { name: 'Благотворительность', archived_at: 'x' },
      { name: 'Аренда зала', archived_at: null },
    ]);
  });

  it('mergeTemplate без системных статей падает понятной ошибкой', () => {
    const { svc, companyId } = setup();
    expect(() => svc.mergeTemplate(t.db, companyId, getTemplate('computer-club')!)).toThrow(/salary/);
  });
});
