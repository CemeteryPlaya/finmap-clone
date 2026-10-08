import { describe, expect, it } from 'vitest';
import type { CategoryNode, CategoryTree } from '../../src/client/lib/queries';
import {
  applyPreset,
  droppedText,
  newLine,
  presetContext,
  presetFromSplit,
  similarSplit,
  splitLines,
  splitResult,
  startSplit,
  type SplitDraft,
} from '../../src/client/lib/split';

const lines = (mode: SplitDraft['mode'], ...values: string[]): SplitDraft => ({
  mode,
  lines: values.map((value, i) => newLine({ categoryId: 10 + i, projectId: null, value })),
});
const strip = (s: SplitDraft | null) => s && { mode: s.mode, lines: s.lines.map(({ categoryId, projectId, value }) => ({ categoryId, projectId, value })) };

const node = (id: number, kind: 'income' | 'expense', archivedAt: string | null = null, children: CategoryNode[] = []): CategoryNode => ({
  id,
  companyId: 1,
  kind,
  parentId: null,
  name: `c${id}`,
  systemKey: null,
  effectiveSystemKey: null,
  templateRef: null,
  orderIndex: 0,
  archivedAt,
  children,
});

describe('splitResult — строки разбиения и нераспределённый остаток', () => {
  it('суммами: выражения в строках, остаток и готовность', () => {
    const r = splitResult(lines('amount', '600', '300+100'), 100000, 2);
    expect(r).toEqual({ amounts: [60000, 40000], errors: [null, null], left: 0, ok: true });
    expect(splitResult(lines('amount', '600', '300'), 100000, 2)).toMatchObject({ left: 10000, ok: false });
    expect(splitResult(lines('amount', '600', '500'), 100000, 2)).toMatchObject({ left: -10000, ok: false });
    expect(splitResult(lines('amount', '600', ''), 100000, 2)).toMatchObject({ errors: [null, 'Введите сумму'], left: 40000, ok: false });
    expect(splitResult(lines('amount', '1000', '0'), 100000, 2).errors[1]).toBe('Сумма больше нуля');
    expect(splitResult(lines('amount', '1000', '1/0'), 100000, 2).errors[1]).toBe('Деление на ноль');
    expect(splitResult(lines('amount', '600', '400'), null, 2)).toMatchObject({ left: null, ok: false });
  });

  it('в процентах: доли переводятся в суммы методом наибольшего остатка, сумма строк равна сумме операции', () => {
    const r = splitResult(lines('percent', '33,33', '33,33', '33,34'), 100, 2);
    expect(r.ok).toBe(true);
    expect(r.amounts).toEqual([33, 33, 34]);
    const thirds = splitResult(lines('percent', '50', '25', '25'), 1001, 2);
    expect(thirds.amounts).toEqual([501, 250, 250]);
    expect(thirds.amounts.reduce((s, a) => s! + a!, 0)).toBe(1001);
    expect(splitResult(lines('percent', '70', '20'), 100000, 2)).toMatchObject({ left: 1000, ok: false });
    expect(splitResult(lines('percent', '70', 'abc'), 100000, 2).errors[1]).toBe('Введите долю, например 25 или 12,5');
    expect(splitResult(lines('percent', '100', '0'), 100000, 2).errors[1]).toBe('Доля больше 0');
    // 1 тиын на 99,99 % и 0,01 %: вторая строка получила бы 0
    expect(splitResult(lines('percent', '99,99', '0,01'), 1, 2)).toMatchObject({ amounts: [1, 0], ok: false, errors: [null, 'Слишком маленькая доля для этой суммы'] });
    expect(splitResult(lines('percent', '60', '40'), null, 2)).toMatchObject({ left: 0, ok: false });
  });

  it('splitLines, startSplit, similarSplit', () => {
    const s = lines('percent', '75', '25');
    expect(splitLines(s, splitResult(s, 1000, 2))).toEqual([
      { categoryId: 10, projectId: null, amount: 750 },
      { categoryId: 11, projectId: null, amount: 250 },
    ]);
    expect(strip(startSplit(7, 8, '1500'))).toEqual({
      mode: 'amount',
      lines: [
        { categoryId: 7, projectId: 8, value: '1500' },
        { categoryId: null, projectId: null, value: '' },
      ],
    });
    expect(similarSplit(s)).toBe(s);
    expect(strip(similarSplit(lines('amount', '1', '2')))!.lines.map((l) => l.value)).toEqual(['', '']);
  });
});

describe('шаблоны разделения', () => {
  const tree: CategoryTree = {
    income: [node(1, 'income')],
    expense: [node(10, 'expense'), node(11, 'expense', '2026-10-01T00:00:00Z'), node(12, 'expense', '2026-10-01T00:00:00Z', [node(13, 'expense')])],
  };
  const ctx = presetContext(tree, [{ id: 5, archivedAt: null }, { id: 6, archivedAt: '2026-10-01T00:00:00Z' }], 'expense');

  it('применение: недоступные элементы отбрасываются и считаются (инвариант 10); строка без статьи и проекта не применяется', () => {
    const r = applyPreset(
      [
        { categoryId: 10, projectId: 5, bp: 5000 },
        { categoryId: 11, projectId: 5, bp: 2000 }, // статья в архиве — остаётся проект
        { categoryId: 13, projectId: 6, bp: 2000 }, // дочерняя архивной и архивный проект — строки нет
        { categoryId: 1, projectId: null, bp: 500 }, // статья доходов в расходе
        { categoryId: 99, projectId: null, bp: 500 }, // удалённая статья
      ],
      ctx,
    );
    expect(r.dropped).toBe(5);
    expect(strip(r.split)).toEqual({
      mode: 'percent',
      lines: [
        { categoryId: 10, projectId: 5, value: '50' },
        { categoryId: null, projectId: 5, value: '20' },
      ],
    });
    expect(splitResult(r.split!, 1000, 2).left).toBe(3000);
    expect(applyPreset([{ categoryId: 11, projectId: null, bp: 10000 }], ctx)).toEqual({ split: null, dropped: 1 });
    expect(droppedText(1)).toBe('1 элемент недоступен');
    expect(droppedText(3)).toBe('3 элемента недоступны');
    expect(droppedText(5)).toBe('5 элементов недоступно');
  });

  it('сохранение: доли из процентов как есть, из сумм — наибольшим остатком до ровно 100 %', () => {
    const p = lines('percent', '33,33', '66,67');
    expect(presetFromSplit(p, splitResult(p, 100, 2))).toEqual({
      ok: true,
      lines: [
        { categoryId: 10, projectId: null, bp: 3333 },
        { categoryId: 11, projectId: null, bp: 6667 },
      ],
    });
    const a = lines('amount', '1', '1', '1');
    const saved = presetFromSplit(a, splitResult(a, 300, 2));
    expect(saved.ok && saved.lines.map((l) => l.bp)).toEqual([3334, 3333, 3333]);
    expect(presetFromSplit(lines('percent', '50', '40'), splitResult(lines('percent', '50', '40'), 100, 2))).toEqual({ ok: false, error: 'Распределите 100 %' });
    const empty: SplitDraft = { mode: 'percent', lines: [newLine({ value: '100' })] };
    expect(presetFromSplit(empty, splitResult(empty, 100, 2))).toEqual({ ok: false, error: 'В каждой строке укажите статью или проект' });
  });
});
