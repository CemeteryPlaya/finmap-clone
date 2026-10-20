import { afterEach, describe, expect, it } from 'vitest';
import { createAuditService, sanitizeDiff } from '../../src/server/modules/audit/service';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

describe('audit', () => {
  it('sanitizeDiff вырезает пароли, хэши, токены и секреты на любой глубине', () => {
    expect(
      sanitizeDiff({
        name: 'Админ',
        password: 'p',
        passwordHash: 'h',
        nested: { tokenHash: 't', apiSecret: 's', ok: 1 },
        list: [{ sessionToken: 'x', v: 2 }],
      }),
    ).toEqual({ name: 'Админ', nested: { ok: 1 }, list: [{ v: 2 }] });
  });

  it('записывает и отдаёт события компании от новых к старым', async () => {
    t = createTestDb();
    let n = 0;
    const audit = createAuditService(t.db, () => new Date(Date.UTC(2026, 9, 5, 10, 0, n++)));
    await audit.record({ companyId: 1, userId: 7, entity: 'account', entityId: 3, action: 'create', diff: { name: 'Касса' } });
    await audit.record({ companyId: 1, userId: 7, entity: 'account', entityId: 3, action: 'archive' });
    await audit.record({ companyId: 2, userId: 7, entity: 'account', entityId: 9, action: 'create' });
    await audit.record({ companyId: null, userId: 7, entity: 'user', entityId: 7, action: 'login' });

    const rows = await audit.list({ companyId: 1 });
    expect(rows.map((r) => r.action)).toEqual(['archive', 'create']);
    expect(rows[1]!.diff).toEqual({ name: 'Касса' });
    expect(rows[1]!.at).toBe('2026-10-05T10:00:00.000Z');

    expect((await audit.list({ companyId: null })).map((r) => r.entity)).toEqual(['user']);
    expect((await audit.list({ companyId: 1, beforeId: rows[0]!.id })).map((r) => r.action)).toEqual(['create']);
  });

  it('не сохраняет секретные поля в diff', async () => {
    t = createTestDb();
    const audit = createAuditService(t.db);
    await audit.record({ userId: 1, entity: 'user', entityId: 1, action: 'password_change', diff: { passwordHash: 'h' } });
    expect((await audit.list({ companyId: null }))[0]!.diff).toEqual({});
  });
});
