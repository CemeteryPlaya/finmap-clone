import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedCurrencies } from '../../src/server/db/seed';
import { createAccountsService } from '../../src/server/modules/accounts/service';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createCategoriesService } from '../../src/server/modules/categories/service';
import { createCompaniesService } from '../../src/server/modules/companies/service';
import { createProjectsService } from '../../src/server/modules/projects/service';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

describe('projects service: атомарность создания', () => {
  it('сбой на втором счёте откатывает проект, категории шаблона, счета и историю', () => {
    t = createTestDb();
    seedCurrencies(t.db);
    const now = () => new Date('2026-10-06T00:00:00.000Z');
    const audit = createAuditService(t.db, now);
    const categories = createCategoriesService({ db: t.db, audit, now });
    const accounts = createAccountsService({ db: t.db, audit, timezone: 'Asia/Almaty', now });
    const companies = createCompaniesService({ db: t.db, audit, categories, accounts, now });
    const projects = createProjectsService({ db: t.db, audit, companies, categories, accounts, timezone: 'Asia/Almaty', now });
    const company = companies.create({ name: 'ТОО', baseCurrency: 'KZT' }, 1);
    const auditBefore = (t.sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity = 'project'").get() as { n: number }).n;
    expect(auditBefore).toBe(0);

    const realCreate = accounts.create.bind(accounts);
    let calls = 0;
    vi.spyOn(accounts, 'create').mockImplementation((ex, input) => {
      calls += 1;
      if (calls === 2) throw new Error('сбой на втором счёте');
      return realCreate(ex, input);
    });

    expect(() =>
      projects.create(company.id, { name: 'Клуб', templateKey: 'computer-club', templateParams: { pcCount: 30 } }, 1),
    ).toThrow('сбой на втором счёте');
    expect(calls).toBe(2);

    const n = (sql: string) => (t.sqlite.prepare(sql).get(company.id) as { n: number }).n;
    expect(n('SELECT COUNT(*) n FROM projects WHERE company_id = ?')).toBe(0);
    expect(n('SELECT COUNT(*) n FROM categories WHERE company_id = ? AND template_ref IS NOT NULL')).toBe(0);
    expect(n('SELECT COUNT(*) n FROM accounts WHERE company_id = ?')).toBe(0);
    expect(n("SELECT COUNT(*) n FROM audit_log WHERE company_id = ? AND entity = 'project'")).toBe(0);
  });
});
