import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { MIGRATIONS_DIR, runMigrations } from '../../src/server/db/migrate';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('миграция 0011 (отмена действий журнала, план 2026-10-20)', () => {
  it('таблица audit_undo: запись истории → запись «Отмена»; индекс записей по сущности', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mig11-'));
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries[11]!.tag).toMatch(/^0011_/);
    const { db, sqlite } = openDb(path.join(dir, 'app.db'));
    runMigrations(db);
    const cols = sqlite.prepare("PRAGMA table_info('audit_undo')").all() as { name: string; notnull: number; pk: number }[];
    expect(cols.map((c) => [c.name, c.notnull, c.pk])).toEqual([
      ['audit_id', 1, 1],
      ['undo_id', 1, 0],
    ]);
    const index = sqlite.prepare("PRAGMA index_info('audit_entity_idx')").all() as { name: string }[];
    expect(index.map((c) => c.name)).toEqual(['company_id', 'entity', 'entity_id']);
    sqlite.close();
  });
});
