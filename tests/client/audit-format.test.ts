import { describe, expect, it } from 'vitest';
import { COMPANY_ENTITIES, diffRows, ENTITY_LABELS, formatBytes, SYSTEM_ENTITIES } from '../../src/client/lib/audit-format';

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

  it('у каждой сущности фильтров есть подпись; операции, курсы и вложения — в своих лентах', () => {
    for (const e of [...COMPANY_ENTITIES, ...SYSTEM_ENTITIES]) expect(ENTITY_LABELS[e]).toBeTruthy();
    expect(ENTITY_LABELS).toMatchObject({ operation: 'Операция', rate: 'Курс', fixed_rate: 'Фиксированный курс', attachment: 'Вложение' });
    expect(COMPANY_ENTITIES).toEqual(expect.arrayContaining(['operation', 'fixed_rate', 'attachment']));
    expect(SYSTEM_ENTITIES).toEqual(['user', 'rate']);
  });
});
