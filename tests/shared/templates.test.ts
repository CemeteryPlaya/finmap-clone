import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { systemCategory } from '../../src/shared/system-categories';
import { getTemplate, TEMPLATES } from '../../src/templates';
import { isUnderSystem, type CategoryNode } from '../../src/templates/types';

function refsOf(nodes: CategoryNode[]): string[] {
  return nodes.flatMap((n) => [...(isUnderSystem(n) ? [] : [n.ref]), ...(n.children ?? []).map((c) => c.ref)]);
}

describe('шаблоны', () => {
  it('есть general и computer-club', () => {
    expect(TEMPLATES.map((t) => t.key)).toEqual(['computer-club', 'general']);
    expect(getTemplate('computer-club')?.name).toBe('Компьютерный клуб');
    expect(getTemplate('general')?.name).toBe('Общий');
    expect(getTemplate('nope')).toBeUndefined();
  });

  it.each(TEMPLATES.map((t) => [t.key, t] as const))('%s: ref уникальны и с префиксом шаблона', (key, t) => {
    const refs = [...refsOf(t.categories.income), ...refsOf(t.categories.expense)];
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.every((r) => r.startsWith(`${key}:`))).toBe(true);
  });

  it.each(TEMPLATES.map((t) => [t.key, t] as const))('%s: underSystem ссылается на системную статью своего вида', (_k, t) => {
    for (const kind of ['income', 'expense'] as const) {
      for (const n of t.categories[kind]) {
        if (isUnderSystem(n)) expect(systemCategory(n.underSystem).kind).toBe(kind);
      }
    }
  });

  it.each(TEMPLATES.map((t) => [t.key, t] as const))('%s: paramsUi совпадает с полями схемы', (_k, t) => {
    const shape = (t.params as unknown as z.ZodObject<z.ZodRawShape>).shape;
    expect(t.paramsUi.map((p) => p.key)).toEqual(Object.keys(shape));
  });

  it('computer-club: параметры по спецификации', () => {
    const t = getTemplate('computer-club')!;
    expect(t.params.parse({ pcCount: 30 })).toEqual({ pcCount: 30, consoleCount: 0 });
    expect(t.params.safeParse({ pcCount: 0 }).success).toBe(false);
    expect(t.params.safeParse({ pcCount: 30, consoleCount: -1 }).success).toBe(false);
    expect(t.params.safeParse({}).success).toBe(false);
    expect(t.params.parse({ pcCount: 30, extra: 1 })).toEqual({ pcCount: 30, consoleCount: 0 });
    expect(t.defaultAccounts).toEqual([
      { name: 'Касса {project}', currency: 'KZT' },
      { name: 'Kaspi {project}', currency: 'KZT' },
    ]);
    expect(t.integrations).toEqual(['senet']);
    expect(t.metrics.map((m) => m.key)).toEqual(['revenuePerPcPerDay', 'barShare', 'payrollToRevenue', 'rentToRevenue']);
    const salary = t.categories.expense.find(isUnderSystem)!;
    expect(salary.underSystem).toBe('salary');
    expect(salary.children.map((c) => c.name)).toEqual(['Администраторы', 'Премии']);
  });

  it('general: пустой', () => {
    const t = getTemplate('general')!;
    expect(t.params.parse({})).toEqual({});
    expect(t.categories).toEqual({ income: [], expense: [] });
    expect(t.defaultAccounts).toEqual([]);
    expect(t.integrations).toEqual([]);
    expect(t.metrics).toEqual([]);
  });
});

describe('computer-club: границы параметров', () => {
  it('pcCount и consoleCount не больше 1000', () => {
    const params = getTemplate('computer-club')!.params;
    expect(params.safeParse({ pcCount: 1000, consoleCount: 1000 }).success).toBe(true);
    expect(params.safeParse({ pcCount: 1001 }).error?.issues[0]?.message).toBe('Не больше 1000');
    expect(params.safeParse({ pcCount: 1, consoleCount: 1001 }).error?.issues[0]?.message).toBe('Не больше 1000');
  });
});
