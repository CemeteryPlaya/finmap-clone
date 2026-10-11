import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/client/lib/api';
import { ASSIGN_TITLES, assignLabel, assignOptions, assignPatch, canAssign, withAssigned, type AssignData, type AssignTarget } from '../../src/client/lib/journal-assign';
import type { CategoryNode, Counterparty, Project } from '../../src/client/lib/queries';
import { operationErrorText } from '../../src/client/lib/journal-mutations';

const FIELDS = ['counterparty', 'category', 'project'] as const;
const line = (categoryId: number | null, projectId: number | null, amount = 1000) => ({ id: 1, position: 0, categoryId, projectId, amount, baseAmount: amount });
const op = (patch: Partial<AssignTarget>): AssignTarget => ({
  type: 'expense',
  version: 3,
  amount: 1000,
  baseAmount: 1000,
  counterpartyId: null,
  lines: [line(null, null)],
  ...patch,
});

describe('«Указать» (§7)', () => {
  it('только пустая ячейка операции с одной строкой; проект — ещё у перевода без строк', () => {
    const bare = op({});
    expect(FIELDS.map((f) => canAssign(bare, f))).toEqual([true, true, true]);
    const filled = op({ counterpartyId: 5, lines: [line(7, 8)] });
    expect(FIELDS.map((f) => canAssign(filled, f))).toEqual([false, false, false]);
    // разбитая операция — только через форму
    const split = op({ lines: [line(null, null, 400), line(null, null, 600)] });
    expect(FIELDS.map((f) => canAssign(split, f))).toEqual([false, false, false]);
    // перевод: нет контрагента и категории; проект — если строки нет или в ней нет проекта
    const transfer = op({ type: 'transfer', lines: [] });
    expect(FIELDS.map((f) => canAssign(transfer, f))).toEqual([false, false, true]);
    expect(canAssign(op({ type: 'transfer', lines: [line(null, 9)] }), 'project')).toBe(false);
  });

  it('тело PATCH: версия и одно поле; строка сохраняет остальные значения и сумму; перевод получает строку на всю сумму', () => {
    expect(assignPatch(op({}), 'counterparty', 5)).toEqual({ version: 3, counterpartyId: 5 });
    expect(assignPatch(op({ lines: [line(null, 8)] }), 'category', 7)).toEqual({ version: 3, lines: [{ categoryId: 7, projectId: 8, amount: 1000 }] });
    expect(assignPatch(op({ lines: [line(7, null)] }), 'project', 9)).toEqual({ version: 3, lines: [{ categoryId: 7, projectId: 9, amount: 1000 }] });
    expect(assignPatch(op({ type: 'transfer', amount: 47512, lines: [] }), 'project', 9)).toEqual({
      version: 3,
      lines: [{ categoryId: null, projectId: 9, amount: 47512 }],
    });
  });

  it('оптимистичный показ: значение подставлено, остальное как было', () => {
    expect(withAssigned(op({}), 'counterparty', 5).counterpartyId).toBe(5);
    expect(withAssigned(op({ lines: [line(null, 8)] }), 'category', 7).lines).toEqual([line(7, 8)]);
    expect(withAssigned(op({ type: 'transfer', amount: 500, baseAmount: 500, lines: [] }), 'project', 9).lines).toEqual([
      { id: 0, position: 0, categoryId: null, projectId: 9, amount: 500, baseAmount: 500 },
    ]);
  });

  it('текст ошибки: конфликт версии — журнал обновлён; удалённая операция — без «повторите»; прочее — как есть', () => {
    expect(operationErrorText(new ApiError(409, 'VERSION_CONFLICT', 'Операция изменена другим пользователем'))).toBe(
      'Операция изменена другим пользователем. Журнал обновлён — проверьте и повторите.',
    );
    expect(operationErrorText(new ApiError(409, 'VERSION_CONFLICT', 'Операция удалена — обновите страницу'))).toBe(
      'Операция удалена другим пользователем. Журнал обновлён.',
    );
    expect(operationErrorText(new ApiError(422, 'ARCHIVED_REFERENCE', 'Категория «Старая» в архиве — выберите другую'))).toBe('Категория «Старая» в архиве — выберите другую');
    // сообщение сервера уже с точкой на конце — вторая не добавляется
    expect(operationErrorText(new ApiError(409, 'VERSION_CONFLICT', 'Операция изменена другим пользователем.'))).toBe(
      'Операция изменена другим пользователем. Журнал обновлён — проверьте и повторите.',
    );
    expect(operationErrorText(new Error('x'))).toBe('Ошибка сервера');
  });
});

describe('окно «Указать» (§5.4 этапа 1.5)', () => {
  const ARCH = '2026-10-01T00:00:00.000Z';
  const node = (id: number, name: string, patch: Partial<CategoryNode> = {}): CategoryNode => ({
    id,
    companyId: 1,
    kind: 'expense',
    parentId: null,
    name,
    systemKey: null,
    effectiveSystemKey: null,
    templateRef: null,
    orderIndex: 0,
    archivedAt: null,
    children: [],
    ...patch,
  });
  const cp = (id: number, name: string, type: Counterparty['type'], archivedAt: string | null = null): Counterparty => ({
    id,
    companyId: 1,
    type,
    name,
    comment: null,
    orderIndex: id,
    createdAt: ARCH,
    archivedAt,
  });
  const project = (id: number, name: string, archivedAt: string | null = null): Project => ({
    id,
    companyId: 1,
    name,
    templateKey: 'general',
    templateParams: {},
    orderIndex: id,
    createdAt: ARCH,
    archivedAt,
  });
  const data: AssignData = {
    categories: {
      income: [node(1, 'Выручка', { kind: 'income' })],
      expense: [
        node(10, 'Зарплата', {
          systemKey: 'salary',
          effectiveSystemKey: 'salary',
          children: [node(11, 'Администраторы', { parentId: 10, effectiveSystemKey: 'salary' })],
        }),
        node(20, 'Аренда'),
        node(30, 'Старая', { archivedAt: ARCH }),
      ],
    },
    projects: [project(5, 'Клуб 1'), project(6, 'Закрытый', ARCH)],
    counterparties: [cp(7, 'ИП Клиент', 'client'), cp(8, 'Алина', 'employee'), cp(9, 'Уволен', 'employee', ARCH)],
  };

  it('заголовки окна; подпись поля контрагента — по системной категории операции, иначе «Мой контрагент»', () => {
    expect(ASSIGN_TITLES).toEqual({
      counterparty: 'Редактирование контрагента',
      category: 'Редактирование категории',
      project: 'Редактирование проекта',
    });
    expect(assignLabel(op({ lines: [line(10, null)] }), 'counterparty', data.categories)).toBe('Сотрудник');
    expect(assignLabel(op({ lines: [line(11, null)] }), 'counterparty', data.categories)).toBe('Сотрудник');
    expect(assignLabel(op({ lines: [line(20, null)] }), 'counterparty', data.categories)).toBe('Мой контрагент');
    expect(assignLabel(op({}), 'counterparty', data.categories)).toBe('Мой контрагент');
    expect(assignLabel(op({}), 'category', data.categories)).toBe('Категория');
    expect(assignLabel(op({}), 'project', data.categories)).toBe('Проект');
  });

  it('варианты: без архивных; категории только вида операции; контрагенты подходящего типа — первыми, как в форме', () => {
    expect(assignOptions(op({}), 'category', data).map((o) => o.label)).toEqual(['Зарплата', 'Зарплата → Администраторы', 'Аренда']);
    expect(assignOptions(op({ type: 'income' }), 'category', data).map((o) => o.label)).toEqual(['Выручка']);
    expect(assignOptions(op({ type: 'transfer', lines: [] }), 'category', data)).toEqual([]);
    expect(assignOptions(op({}), 'project', data).map((o) => o.label)).toEqual(['Клуб 1']);
    expect(assignOptions(op({ lines: [line(10, null)] }), 'counterparty', data)).toEqual([
      { id: 8, label: 'Алина', section: 'Сотрудники' },
      { id: 7, label: 'ИП Клиент', section: 'Остальные' },
    ]);
    expect(assignOptions(op({}), 'counterparty', data)).toEqual([
      { id: 7, label: 'ИП Клиент' },
      { id: 8, label: 'Алина' },
    ]);
  });
});

describe('«Указать»: кэш и мутации', () => {
  const item = (version: number, comment: string) => ({ id: 7, version, comment, lines: [] });
  const page = (...items: ReturnType<typeof item>[]) => ({ pages: [{ items, nextCursor: null }], pageParams: [null] });

  it('cachedOperation берёт самую свежую версию среди всех кэшей журнала', async () => {
    const { queryClient } = await import('../../src/client/lib/query');
    const { cachedOperation } = await import('../../src/client/lib/journal-mutations');
    queryClient.clear();
    queryClient.setQueryData(['journal', 5, 'a'], page(item(3, 'свежая')));
    queryClient.setQueryData(['journal', 5, 'b'], page(item(2, 'старая')));
    expect(cachedOperation(5, 7)).toMatchObject({ version: 3 });
    expect(cachedOperation(5, 8)).toBeUndefined();
    queryClient.clear();
  });

  it('после завершения мутация не остаётся в кэше', async () => {
    const { vi } = await import('vitest');
    const { queryClient } = await import('../../src/client/lib/query');
    const { runAssign } = await import('../../src/client/lib/journal-mutations');
    queryClient.clear();
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ operation: { version: 2, updatedAt: 'x', counterpartyId: 1, lines: [] } }), { status: 200 }));
    const vars = { item: { ...op({}), id: 7 } as never, field: 'counterparty' as const, id: 1 };
    await runAssign(5, vars, () => undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    vi.unstubAllGlobals();
    queryClient.clear();
  });
});
