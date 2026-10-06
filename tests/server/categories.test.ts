import { afterEach, describe, expect, it } from 'vitest';
import { companies } from '../../src/server/db/schema';
import { seedCurrencies } from '../../src/server/db/seed';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { getTemplate } from '../../src/templates';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

function setup() {
  t = createTestDb();
  seedCurrencies(t.db);
  const company = t.db.insert(companies).values({ name: 'ТОО', baseCurrency: 'KZT', createdAt: 'x' }).returning().get();
  const svc = createCategoriesService({ db: t.db, audit: createAuditService(t.db), now: () => new Date('2026-10-06T00:00:00.000Z') });
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

  it.each(['moved', 'archived'] as const)(
    'mergeTemplate: группа шаблона %s — новые дочерние встают на верхний уровень (Review Focus 3)',
    (variant) => {
      const { svc, companyId } = setup();
      const club = getTemplate('computer-club')!;
      svc.seedSystem(t.db, companyId);
      svc.mergeTemplate(t.db, companyId, club);
      const s = t.sqlite;
      const premises = s.prepare("SELECT id FROM categories WHERE template_ref = 'computer-club:premises'").get() as { id: number };
      // пользователь убрал дочерние «Помещения», затем перенёс группу в свою или отправил в архив
      s.prepare('DELETE FROM categories WHERE parent_id = ?').run(premises.id);
      if (variant === 'moved') {
        const mine = svc.add(companyId, { kind: 'expense', name: 'Моя группа', parentId: null }, 1);
        s.prepare('UPDATE categories SET parent_id = ? WHERE id = ?').run(mine.id, premises.id);
      } else {
        s.prepare("UPDATE categories SET archived_at = 'x' WHERE id = ?").run(premises.id);
      }
      expect(svc.mergeTemplate(t.db, companyId, club)).toBe(4);
      const depth3 = s
        .prepare('SELECT COUNT(*) n FROM categories c JOIN categories p ON p.id = c.parent_id WHERE p.parent_id IS NOT NULL')
        .get() as { n: number };
      expect(depth3.n).toBe(0);
      const underPremises = s.prepare('SELECT COUNT(*) n FROM categories WHERE parent_id = ?').get(premises.id) as { n: number };
      expect(underPremises.n).toBe(0);
      const rent = s.prepare("SELECT parent_id FROM categories WHERE template_ref = 'computer-club:rent'").get() as { parent_id: number | null };
      expect(rent.parent_id).toBeNull();
    },
  );
});
