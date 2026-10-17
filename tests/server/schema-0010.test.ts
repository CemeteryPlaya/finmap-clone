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

describe('миграция 0010 (настройки «Финансовых показателей», план А-4)', () => {
  it('таблица analytics_indicator_parts: часть на компанию — первичный ключ (company_id, part)', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mig10-'));
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries[10]!.tag).toMatch(/^0010_/);
    const { db, sqlite } = openDb(path.join(dir, 'app.db'));
    runMigrations(db);
    const cols = sqlite.prepare("PRAGMA table_info('analytics_indicator_parts')").all() as { name: string; notnull: number; pk: number }[];
    expect(cols.map((c) => [c.name, c.notnull, c.pk])).toEqual([
      ['company_id', 1, 1],
      ['part', 1, 2],
      ['all_categories', 1, 0],
      ['category_ids', 1, 0],
      ['include_stock', 1, 0],
      ['updated_at', 1, 0],
      ['updated_by', 0, 0],
    ]);
    sqlite.close();
  });
});
