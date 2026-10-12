import { describe, expect, it } from 'vitest';
import { createImportCache, type CachedImport } from '../../src/server/modules/imports/cache';

const item = (companyId: number, userId: number, name = 'f.xlsx'): CachedImport => ({
  companyId,
  userId,
  file: { name, size: 1, sha256: 'x' },
  parsed: { headerRow: 1, total: 0, rows: [], future: [], issues: [] },
});

describe('кэш проверки (§6.3 спецификации импорта)', () => {
  it('токен — 128 бит; файл только своей компании и своего пользователя; remove удаляет', () => {
    const cache = createImportCache();
    const t = cache.put(item(1, 1));
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(cache.put(item(1, 2))).not.toBe(t);
    expect(cache.get(t, 1, 1)!.file.name).toBe('f.xlsx');
    expect(cache.get(t, 2, 1)).toBeNull();
    expect(cache.get(t, 1, 2)).toBeNull();
    expect(cache.get('нет', 1, 1)).toBeNull();
    cache.remove(t);
    expect(cache.get(t, 1, 1)).toBeNull();
  });

  it('срок — 30 минут с последнего обращения', () => {
    let clock = 0;
    const cache = createImportCache({ now: () => clock });
    const t = cache.put(item(1, 1));
    clock = 29 * 60_000;
    expect(cache.get(t, 1, 1)).not.toBeNull(); // обращение продлевает срок
    clock += 30 * 60_000;
    expect(cache.get(t, 1, 1)).not.toBeNull();
    clock += 30 * 60_000 + 1;
    expect(cache.get(t, 1, 1)).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('новая загрузка того же пользователя в ту же компанию заменяет прежнюю; больше 3 файлов — вытесняется самый давний', () => {
    let clock = 0;
    const cache = createImportCache({ now: () => clock++ });
    const first = cache.put(item(1, 1, 'старый'));
    const again = cache.put(item(1, 1, 'новый'));
    expect(cache.get(first, 1, 1)).toBeNull();
    expect(cache.get(again, 1, 1)!.file.name).toBe('новый');
    const b = cache.put(item(2, 1));
    const c = cache.put(item(3, 1));
    cache.get(again, 1, 1); // «новый» — свежий, самый давний теперь b
    const d = cache.put(item(4, 1));
    expect(cache.size()).toBe(3);
    expect(cache.get(b, 2, 1)).toBeNull();
    expect([again, c, d].map((t, i) => cache.get(t, [1, 3, 4][i]!, 1) !== null)).toEqual([true, true, true]);
  });
});
