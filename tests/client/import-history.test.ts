import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_TABS,
  importAddedText,
  importMetaText,
  importUndoneText,
  replaceImportItem,
  tabAfterKey,
  undoButtonLabel,
  undoCheckboxLabel,
  undoConfirmText,
  undoImport,
  undoResultText,
} from '../../src/client/lib/import-history';
import type { ImportListItem, ImportListPage, ImportUndoResult } from '../../src/shared/schemas/imports';

const TZ = 'Asia/Almaty';

/** Запись списка: импорт 12.10.2026 15:02:11 по Алматы, 1 234 операции. */
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

const zero = { accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 };

describe('кнопка «Отменить» и подтверждение отмены (§7.2–§7.3)', () => {
  it('доступное имя «Отменить» называет файл и момент импорта', () => {
    expect(undoButtonLabel(item(), TZ)).toBe('Отменить импорт «выгрузка.xlsx» от 12.10.2026, 15:02');
  });

  it('без изменённых: сколько операций удалится и что будет с созданным', () => {
    expect(undoConfirmText(item(), false)).toBe(
      'Будут удалены 1\u202F234 операции из файла «выгрузка.xlsx», а также созданные импортом счета, категории, контрагенты, проекты и теги, если они больше нигде не используются.',
    );
    expect(undoConfirmText(item({ pending: { operations: 1, edited: 0 } }), false)).toMatch(/^Будет удалена 1 операция из файла/);
    expect(undoConfirmText(item({ pending: { operations: 22, edited: 0 } }), false)).toMatch(/^Будут удалены 22 операции из файла/);
    expect(undoConfirmText(item({ pending: { operations: 25, edited: 0 } }), false)).toMatch(/^Будут удалены 25 операций из файла/);
  });

  it('с изменёнными: без флажка они останутся, с флажком — тоже удалятся; флажок называет их число', () => {
    const p = item({ pending: { operations: 1_234, edited: 3 } });
    expect(undoConfirmText(p, false)).toBe(
      'Будет удалена 1\u202F231 операция из файла «выгрузка.xlsx», а также созданные импортом счета, категории, контрагенты, проекты и теги, если они больше нигде не используются. После импорта изменены 3 операции — они останутся.',
    );
    expect(undoConfirmText(p, true)).toMatch(/^Будут удалены 1\u202F234 операции .* После импорта изменены 3 операции — они тоже будут удалены\.$/);
    expect(undoConfirmText(item({ pending: { operations: 5, edited: 1 } }), false)).toMatch(/После импорта изменена 1 операция — она останется\.$/);
    expect(undoConfirmText(item({ pending: { operations: 5, edited: 1 } }), true)).toMatch(/После импорта изменена 1 операция — она тоже будет удалена\.$/);
    expect(undoCheckboxLabel(3)).toBe('Удалить и изменённые (3)');
  });

  it('все операции изменены, флажок снят — операции не удаляются', () => {
    expect(undoConfirmText(item({ pending: { operations: 2, edited: 2 } }), false)).toBe(
      'Операции из файла «выгрузка.xlsx» не удаляются. Будут удалены созданные импортом счета, категории, контрагенты, проекты и теги, если они больше нигде не используются. После импорта изменены 2 операции — они останутся.',
    );
  });
});

describe('итог отмены (§7.3)', () => {
  it('удалено и оставлено: изменённые операции, используемые справочники, поля счетов', () => {
    const r: ImportUndoResult = {
      deleted: { operations: 1_230, accounts: 2, categories: 12, counterparties: 25, projects: 0, tags: 1 },
      kept: {
        operations: 4,
        created: { ...zero, categories: 1 },
        names: [{ entity: 'category', name: 'Аренда' }],
        accounts: [],
      },
    };
    expect(undoResultText(r)).toBe(
      'Импорт отменён: удалено 1\u202F230 операций, 2 счёта, 12 категорий, 25 контрагентов, 1 тег. Оставлено: 4 изменённые операции, категория «Аренда» (используется).',
    );
  });

  it('ничего не оставлено — без «Оставлено»; больше названий, чем в итоге, — «и ещё N»; поля счетов с причиной', () => {
    expect(undoResultText({ deleted: { operations: 4, ...zero }, kept: { operations: 0, created: zero, names: [], accounts: [] } })).toBe('Импорт отменён: удалено 4 операции.');
    const r: ImportUndoResult = {
      deleted: { operations: 1, ...zero },
      kept: {
        operations: 0,
        created: { ...zero, counterparties: 22 },
        names: Array.from({ length: 20 }, (_, i) => ({ entity: 'counterparty' as const, name: `К${i}` })),
        accounts: [
          { accountId: 1, name: 'Касса', field: 'startingBalance', reason: 'changed' },
          { accountId: 1, name: 'Касса', field: 'openedAt', reason: 'operations' },
          { accountId: 2, name: 'Сейф', field: 'openedAt', reason: 'archived' },
        ],
      },
    };
    const text = undoResultText(r);
    expect(text).toMatch(/^Импорт отменён: удалено 1 операция\. Оставлено: контрагент «К0» \(используется\), /);
    expect(text).toContain('контрагент «К19» (используется), и ещё 2 (используются), ');
    expect(text).toMatch(
      /стартовый баланс счёта «Касса» \(изменён после импорта\), дата открытия счёта «Касса» \(есть операции раньше прежней даты\), дата открытия счёта «Сейф» \(счёт в архиве\)\.$/,
    );
  });

  it('«и ещё N» согласует «используется»: 1 и 21 — «используется», 2 и 5 — «используются»', () => {
    const more = (n: number) =>
      undoResultText({
        deleted: { operations: 1, ...zero },
        kept: { operations: 0, created: { ...zero, tags: 20 + n }, names: Array.from({ length: 20 }, (_, i) => ({ entity: 'tag' as const, name: `Т${i}` })), accounts: [] },
      });
    expect(more(1)).toMatch(/, и ещё 1 \(используется\)\.$/);
    expect(more(21)).toMatch(/, и ещё 21 \(используется\)\.$/);
    expect(more(2)).toMatch(/, и ещё 2 \(используются\)\.$/);
    expect(more(5)).toMatch(/, и ещё 5 \(используются\)\.$/);
  });

  it('операций не удалено — «удалено 0 операций» не пишется; ничего не удалено — «Импорт отменён.»', () => {
    expect(
      undoResultText({
        deleted: { operations: 0, ...zero, categories: 2 },
        kept: { operations: 3, created: zero, names: [], accounts: [] },
      }),
    ).toBe('Импорт отменён: удалено 2 категории. Оставлено: 3 изменённые операции.');
    expect(
      undoResultText({
        deleted: { operations: 0, ...zero },
        kept: { operations: 2, created: { ...zero, categories: 1 }, names: [{ entity: 'category', name: 'Аренда' }], accounts: [] },
      }),
    ).toBe('Импорт отменён. Оставлено: 2 изменённые операции, категория «Аренда» (используется).');
  });

  it('оставленный созданный импортом счёт: стартовый баланс обнулён — отдельное предложение после «Оставлено» (решение 16 плана И-3)', () => {
    const r: ImportUndoResult = {
      deleted: { operations: 3, ...zero, categories: 1 },
      kept: {
        operations: 1,
        created: { ...zero, accounts: 1 },
        names: [{ entity: 'account', name: 'Банк-2' }],
        accounts: [
          { accountId: 1, name: 'Касса', field: 'openedAt', reason: 'operations' },
          { accountId: 5, name: 'Банк-2', field: 'startingBalance', reason: 'created' },
        ],
      },
    };
    expect(undoResultText(r)).toBe(
      'Импорт отменён: удалено 3 операции, 1 категория. Оставлено: 1 изменённая операция, счёт «Банк-2» (используется), дата открытия счёта «Касса» (есть операции раньше прежней даты). ' +
        'Счёт «Банк-2» оставлен: на нём есть операции; стартовый баланс обнулён — проверьте его в настройках счетов.',
    );
  });
});

describe('список после отмены и запрос', () => {
  it('replaceImportItem: запись заменяется в своей странице, остальные — те же объекты', () => {
    const a = item({ id: 9 });
    const b = item({ id: 7 });
    const data = { pages: [{ items: [a], nextBeforeId: 9 }, { items: [b], nextBeforeId: null }] as ImportListPage[], pageParams: [null, 9] };
    const undone = item({ id: 7, status: 'undone', pending: null });
    const next = replaceImportItem(data, undone)!;
    expect(next.pages[1]!.items).toEqual([undone]);
    expect(next.pages[0]!.items[0]).toBe(a);
    expect(next.pageParams).toEqual([null, 9]);
    expect(replaceImportItem(undefined, undone)).toBeUndefined();
  });

  it('undoImport: POST …/imports/:id/undo с флажком и числом изменённых, которое видел человек', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await undoImport(5, 7, { includeEdited: true, edited: 3 });
    expect(calls[0]!.url).toBe('/api/v1/companies/5/imports/7/undo');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ includeEdited: true, edited: 3 });
  });
});

afterEach(() => vi.unstubAllGlobals());
