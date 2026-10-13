import { describe, expect, it } from 'vitest';
import { HISTORY_TABS, importAddedText, importMetaText, importUndoneText, tabAfterKey } from '../../src/client/lib/import-history';
import type { ImportListItem } from '../../src/shared/schemas/imports';

const TZ = 'Asia/Almaty';

/** Запись списка: импорт 12.10.2026 15:02:11 по Алматы, 1 234 операций. */
function item(over: Partial<ImportListItem> = {}): ImportListItem {
  return {
    id: 7,
    fileName: 'выгрузка.xlsx',
    fileSize: 1000,
    status: 'done',
    createdAt: '2026-10-12T10:02:11.000Z',
    userName: 'Сотрудник А',
    counts: { rows: 1_234, income: 700, expense: 500, transfer: 34, added: 1_234, duplicates: 0, skippedFuture: 0 },
    undoneAt: null,
    undoneByName: null,
    pending: { operations: 1_234, edited: 0 },
    ...over,
  };
}

describe('вкладки «Журнал | Импорты» (§7.1 спецификации импорта)', () => {
  it('две вкладки; ←/→ по кругу, Home и End — крайние, другие клавиши — null', () => {
    expect(HISTORY_TABS.map((t) => t.label)).toEqual(['Журнал', 'Импорты']);
    expect(tabAfterKey('log', 'ArrowRight')).toBe('imports');
    expect(tabAfterKey('imports', 'ArrowRight')).toBe('log');
    expect(tabAfterKey('log', 'ArrowLeft')).toBe('imports');
    expect(tabAfterKey('imports', 'Home')).toBe('log');
    expect(tabAfterKey('log', 'End')).toBe('imports');
    expect(tabAfterKey('log', 'Enter')).toBeNull();
    expect(tabAfterKey('log', 'ArrowDown')).toBeNull();
  });
});

describe('запись списка «Импорты» (§7.2)', () => {
  it('добавлено и дубликаты; кто и когда — до секунд по часам компании', () => {
    expect(importAddedText(item())).toBe('Добавлено 1\u202F234 операции · пропущено дубликатов 0');
    expect(importAddedText(item({ counts: { ...item().counts, added: 1, duplicates: 3 } }))).toBe('Добавлено 1 операция · пропущено дубликатов 3');
    expect(importMetaText(item(), TZ)).toBe('Сотрудник А · 12.10.2026, 15:02:11');
    expect(importMetaText(item({ userName: null }), TZ)).toBe('Пользователь удалён · 12.10.2026, 15:02:11');
  });

  it('«Отменён 12.10.2026, 15:40 (Сотрудник А)» — только у отменённого', () => {
    expect(importUndoneText(item(), TZ)).toBeNull();
    expect(importUndoneText(item({ status: 'undone', undoneAt: '2026-10-12T10:40:00.000Z', undoneByName: 'Сотрудник А', pending: null }), TZ)).toBe(
      'Отменён 12.10.2026, 15:40 (Сотрудник А)',
    );
    expect(importUndoneText(item({ status: 'undone', undoneAt: '2026-10-12T10:40:00.000Z', undoneByName: null, pending: null }), TZ)).toBe('Отменён 12.10.2026, 15:40');
  });
});
