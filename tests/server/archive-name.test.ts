import { describe, expect, it } from 'vitest';
import { ARCHIVE_RE, archiveName } from '../../src/server/modules/backup/archive-name';

describe('archiveName', () => {
  it('форматирует время в APP_TIMEZONE', () => {
    // 2026-10-05 21:30:05 UTC = 2026-10-06 02:30:05 в Алматы (UTC+5)
    expect(archiveName(new Date('2026-10-05T21:30:05.000Z'), 'Asia/Almaty')).toBe('backup-20261006-023005.zip');
    expect(ARCHIVE_RE.test('backup-20261006-023005.zip')).toBe(true);
    expect(ARCHIVE_RE.test('backup-20261006-023005-2.zip')).toBe(true);
    expect(ARCHIVE_RE.test('notes.zip')).toBe(false);
  });
});
