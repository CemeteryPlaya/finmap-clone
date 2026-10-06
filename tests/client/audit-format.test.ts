import { describe, expect, it } from 'vitest';
import { diffRows, formatBytes } from '../../src/client/lib/audit-format';

describe('audit-format', () => {
  it('diffRows: «было → стало» по полям before/after; иначе null', () => {
    expect(diffRows({ before: { name: 'А', archived: false }, after: { name: 'Б', templateParams: { pcCount: 30 } } })).toEqual([
      { field: 'name', before: 'А', after: 'Б' },
      { field: 'archived', before: 'false', after: '—' },
      { field: 'templateParams', before: '—', after: '{"pcCount":30}' },
    ]);
    expect(diffRows({ name: 'Касса' })).toBeNull();
    expect(diffRows({ before: null, after: {} })).toBeNull();
    expect(diffRows(null)).toBeNull();
  });

  it('formatBytes', () => {
    expect(formatBytes(500)).toBe('500 Б');
    expect(formatBytes(1536)).toBe('1,5 КБ');
    expect(formatBytes(1024 * 1024)).toBe('1 МБ');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 ГБ');
  });
});
