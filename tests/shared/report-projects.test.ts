import { describe, expect, it } from 'vitest';
import { startOfDayUtc } from '../../src/shared/dates';
import { columnStarts, reportColumns, type ReportDicts, type ReportFilter, type ReportLine } from '../../src/shared/report-engine';
import { pnlRows, type StockCost, type StockInput } from '../../src/shared/report-pnl';
import {
  incomeExpenseBp,
  marginPercent,
  marginText,
  parseProjectsRow,
  projectLines,
  projectsCellTitle,
  projectsRows,
  ratioText,
  type ProjectRow,
  type ProjectStatus,
} from '../../src/shared/report-projects';

const TZ = 'Asia/Almaty';
const almaty = (date: string) => new Date(Date.parse(startOfDayUtc(date, TZ)) + 12 * 3_600_000).toISOString();

/** Справочники: «Клуб 1» и «Клуб 2» активные, «Клуб 3» в архиве; «Инвестиции» — системная (исключена); «Кола» — подкатегория «Закупа бара». */
const dicts: ReportDicts = {
  categories: [
    { id: 1, kind: 'income', parentId: null, name: 'Бар', archived: false },
    { id: 2, kind: 'income', parentId: null, name: 'Инвестиции', archived: false, systemKey: 'investment' },
    { id: 10, kind: 'expense', parentId: null, name: 'Аренда', archived: false },
    { id: 11, kind: 'expense', parentId: null, name: 'Закуп бара', archived: false },
    { id: 12, kind: 'expense', parentId: 11, name: 'Кола', archived: false },
  ],
  counterparties: [],
  projects: [
    { id: 30, name: 'Клуб 1', archived: false },
    { id: 31, name: 'Клуб 2', archived: false },
    { id: 32, name: 'Клуб 3', archived: true },
  ],
};

const line = (type: 'income' | 'expense', amount: number, categoryId: number | null, projectId: number | null, date = '2026-08-10'): ReportLine => ({
  at: almaty(date),
  type,
  accountId: 1,
  categoryId,
  projectId,
  counterpartyId: null,
  amount,
});
const cost = (kind: StockCost['kind'], amount: number, projectId: number): StockCost => ({ at: almaty('2026-08-15'), kind, projectId, amount });

/**
 * Синтетика (тиыны): «Клуб 1» — доход «Бар» 1 000, расход «Аренда» 300, инвестиции 5 000 (исключены), склад: себестоимость
 * 40 и списание 10; «Клуб 2» — «Кола» 200 и расход без категории 50; архивный «Клуб 3» — «Бар» 400, «Аренда» 100,
 * себестоимость 20; без проекта — «Бар» 500.
 */
const LINES = [
  line('income', 1000, 1, 30),
  line('expense', 300, 10, 30),
  line('income', 5000, 2, 30),
  line('expense', 200, 12, 31),
  line('expense', 50, null, 31),
  line('income', 400, 1, 32),
  line('expense', 100, 10, 32),
  line('income', 500, 1, null),
];
const STOCK: StockInput = { costs: [cost('cogs', 40, 30), cost('writeoff', 10, 30), cost('cogs', 20, 32)], noBatch: [{ at: almaty('2026-08-16'), projectId: 31 }] };

const run = (status: ProjectStatus, extra: { mode?: 'projects' | 'categories'; lines?: ReportLine[]; stock?: StockInput | null; filter?: Parameters<typeof projectsRows>[0]['filter'] } = {}) =>
  projectsRows({ lines: extra.lines ?? LINES, dicts, filter: extra.filter ?? {}, status, mode: extra.mode ?? 'projects', stock: extra.stock === undefined ? STOCK : extra.stock });
const sums = (rows: readonly ProjectRow[]) => rows.map((r) => [r.id, r.label, r.income, r.expense]);
const total = (rows: readonly ProjectRow[]) => rows.reduce((s, r) => [s[0]! + r.income, s[1]! + r.expense], [0, 0]);

describe('«Проекты»: строки (§7)', () => {
  it('«Активные проекты»: проекты статуса, архивные с суммами — одной строкой, «Без проекта», «Всего»; склад — расходом проекта склада', () => {
    const r = run('active');
    expect(sums(r.rows)).toEqual([
      ['project:30', 'Клуб 1', 1000, 350],
      ['project:31', 'Клуб 2', 0, 250],
      ['project:archived', 'Архивные проекты (вместе)', 400, 120],
      ['project:none', 'Без проекта', 500, 0],
    ]);
    expect(r.total).toEqual({ id: 'total', kind: 'total', label: 'Всего', income: 1900, expense: 720 });
    expect(total(r.rows)).toEqual([r.total.income, r.total.expense]);
    expect(r.empty).toBe(false);
    expect(r.noBatch).toBe(1);
  });

  it('«Архивные проекты» и «Все проекты»: архивный — своей строкой с пометкой, активные с суммами — вместе; «Всего» не меняется', () => {
    const archived = run('archived');
    expect(sums(archived.rows)).toEqual([
      ['project:32', 'Клуб 3', 400, 120],
      ['project:active', 'Активные проекты (вместе)', 1000, 600],
      ['project:none', 'Без проекта', 500, 0],
    ]);
    expect(archived.rows[0]!.archived).toBe(true);
    const all = run('all');
    expect(sums(all.rows).map((r) => r[0])).toEqual(['project:30', 'project:31', 'project:32', 'project:none']);
    for (const r of [archived, all]) {
      expect(r.total).toMatchObject({ income: 1900, expense: 720 });
      expect(total(r.rows)).toEqual([1900, 720]);
    }
    // проектов другого статуса без сумм — строки «вместе» нет
    expect(run('archived', { lines: [line('income', 400, 1, 32)], stock: null }).rows.map((r) => r.id)).toEqual(['project:32', 'project:none']);
  });

  it('«Проекты с категориями»: категории верхнего уровня (подкатегория — в родителе), «Без категории», строки склада', () => {
    const r = run('active', { mode: 'categories' });
    const children = (id: string) => sums(r.rows.find((x) => x.id === id)!.children!);
    expect(children('project:30')).toEqual([
      ['project:30:category:1', 'Бар', 1000, 0],
      ['project:30:category:10', 'Аренда', 0, 300],
      ['project:30:stock:cogs', 'Себестоимость проданных товаров', 0, 40],
      ['project:30:stock:writeoff', 'Списания товаров', 0, 10],
    ]);
    expect(children('project:31')).toEqual([
      ['project:31:category:11', 'Закуп бара', 0, 200],
      ['project:31:category:none', 'Без категории', 0, 50],
    ]);
    expect(children('project:archived').map((c) => c[0])).toEqual(['project:archived:category:1', 'project:archived:category:10', 'project:archived:stock:cogs']);
    for (const row of r.rows.filter((x) => x.children)) expect(total(row.children!)).toEqual([row.income, row.expense]);
    // проект без сумм — без детей; «Только проекты» — детей нет вовсе
    expect(run('all', { mode: 'categories', lines: [line('income', 1, 1, 30)], stock: null }).rows.find((x) => x.id === 'project:31')!.children).toBeUndefined();
    expect(run('active').rows.every((x) => x.children === undefined)).toBe(true);
    expect(projectLines(r.rows, r.total).map((l) => [l.row.id, l.parent?.id ?? null]).slice(0, 6)).toEqual([
      ['project:30', null],
      ['project:30:category:1', 'project:30'],
      ['project:30:category:10', 'project:30'],
      ['project:30:stock:cogs', 'project:30'],
      ['project:30:stock:writeoff', 'project:30'],
      ['project:31', null],
    ]);
    expect(projectLines(r.rows, r.total).at(-1)!.row.id).toBe('total');
  });

  it('период без операций и склада: только «Без проекта» и «Всего» нулями; фильтр не по проектам убирает склад', () => {
    const empty = run('active', { lines: [], stock: { costs: [], noBatch: [] } });
    expect(empty.empty).toBe(true);
    expect(sums(empty.rows)).toEqual([['project:none', 'Без проекта', 0, 0]]);
    expect(empty.total).toMatchObject({ income: 0, expense: 0 });
    const filtered = run('active', { lines: LINES.filter((l) => l.categoryId === 1), filter: { categoryIds: [1] } });
    expect(filtered.total).toMatchObject({ income: 1900, expense: 0 });
    expect(filtered.noBatch).toBe(0);
  });

  it('итоги равны итогам «Прибыли» за тот же период со складом и без; строки дают «Всего» при любом статусе; при статусе «Все» строки равны строкам «Прибыли» по проектам, в том числе со складом и под фильтром категорий (свойство)', () => {
    const columns = reportColumns('2026-07-01', '2026-09-30', 'quarter');
    const starts = columnStarts(columns, TZ);
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      // старшие биты: у младших бит такого генератора короткий период (rnd(2) чередовался бы)
      return Math.floor(seed / 65_536) % n;
    };
    const projects = [30, 31, 32, 99, null];
    const categories = [1, 2, 10, 12, null];
    const categoryPool = [1, 10, 11, 12];
    let filteredRounds = 0;
    let stockRows = 0;
    for (let round = 0; round < 60; round++) {
      let lines = Array.from({ length: rnd(25) }, () =>
        line(rnd(2) === 0 ? 'income' : 'expense', rnd(10_000) - 500, categories[rnd(categories.length)]!, projects[rnd(projects.length)]!, `2026-0${7 + rnd(3)}-1${rnd(9)}`),
      );
      const stock: StockInput | null = rnd(2) === 0 ? null : { costs: Array.from({ length: rnd(4) }, () => cost(rnd(2) === 0 ? 'cogs' : 'writeoff', rnd(1000), [30, 31, 32][rnd(3)]!)), noBatch: [] };
      // в части раундов - случайный фильтр по категориям: строки заранее отфильтрованы, склад обязан исчезнуть (§5.3)
      let filter: ReportFilter = {};
      if (round % 3 === 2) {
        const ids = categoryPool.filter(() => rnd(2) === 0);
        if (ids.length > 0) {
          filter = { categoryIds: ids };
          lines = lines.filter((l) => l.categoryId !== null && ids.includes(l.categoryId));
          filteredRounds++;
        }
      }
      const pnl = pnlRows({ columns, starts, lines, by: 'project', dicts, filter, stock });
      const [income, expense] = [pnl.rows.find((r) => r.id === 'income')!, pnl.rows.find((r) => r.id === 'expense')!];
      for (const status of ['active', 'archived', 'all'] as const) {
        for (const mode of ['projects', 'categories'] as const) {
          const r = projectsRows({ lines, dicts, filter, status, mode, stock });
          expect([r.total.income, r.total.expense]).toEqual([income.total, expense.total]);
          expect(total(r.rows)).toEqual([r.total.income, r.total.expense]);
          for (const row of r.rows) if (row.children) expect(total(row.children)).toEqual([row.income, row.expense]);
          if (status !== 'all') continue;
          // строка проекта = строка «Прибыли» по проектам; нет строки у «Прибыли» - нули
          const pnlOf = (group: typeof income, key: string) => group.children?.find((c) => c.id === `${group.id}:project:${key}`)?.total ?? 0;
          for (const row of r.rows) {
            const key = row.id.slice('project:'.length);
            expect([row.id, row.income, row.expense]).toEqual([row.id, pnlOf(income, key), pnlOf(expense, key)]);
          }
          // и наоборот: каждая строка «Прибыли» по проектам есть среди строк «Проектов»
          for (const group of [income, expense]) {
            for (const c of group.children ?? []) {
              expect(r.rows.some((x) => x.id === `project:${c.id.slice(`${group.id}:project:`.length)}`)).toBe(true);
            }
          }
          if (!filter.categoryIds && stock) stockRows += stock.costs.length;
        }
      }
    }
    // сценарий не вырожденный: были и раунды с фильтром, и склад без фильтра
    expect(filteredRounds).toBeGreaterThan(5);
    expect(stockRows).toBeGreaterThan(0);
  });
});

describe('«Проекты»: проценты и «—» (§7)', () => {
  it('«Доход / Расход, %» — 2 знака, «Рентабельность, %» — целое; при нуле делителя — «—»', () => {
    expect(ratioText(incomeExpenseBp(1000, 350))).toBe('285,71');
    expect(ratioText(incomeExpenseBp(89_252_639, 76_755_089))).toBe('116,28');
    expect(marginText(marginPercent(89_252_639 - 76_755_089, 89_252_639))).toBe('14');
    expect(ratioText(incomeExpenseBp(500, 0))).toBe('—');
    expect(ratioText(incomeExpenseBp(0, 250))).toBe('0,00');
    expect(marginText(marginPercent(-250, 0))).toBe('—');
    expect(marginText(marginPercent(0, 0))).toBe('—');
    expect(marginText(marginPercent(-200, 100))).toBe('\u2212200');
    expect(ratioText(incomeExpenseBp(-100, 350))).toBe('\u221228,57');
    // половина округляется от нуля одинаково для обоих знаков
    expect(marginPercent(5, 1000)).toBe(1);
    expect(marginPercent(-5, 1000)).toBe(-1);
  });
});

describe('«Проекты»: строки → операции (§2.5, §7)', () => {
  it('проект, «Без проекта», проекты статуса вместе, категория в проекте, «Всего»; склад не раскрывается', () => {
    expect(parseProjectsRow('project:30')).toEqual({ project: 30 });
    expect(parseProjectsRow('project:none')).toEqual({ project: null });
    expect(parseProjectsRow('project:archived')).toEqual({ project: 'archived' });
    expect(parseProjectsRow('project:active:category:1')).toEqual({ project: 'active', category: 1 });
    expect(parseProjectsRow('project:30:category:none')).toEqual({ project: 30, category: null });
    expect(parseProjectsRow('total')).toEqual({ project: 'any' });
    for (const bad of ['project:30:stock:cogs', 'project:0', 'income:project:30', 'project:', 'project:30:category:', 'profit']) expect(parseProjectsRow(bad)).toBeNull();
  });

  it('заголовок списка: колонка и строка, у категории — «проект → категория», архивный — с пометкой', () => {
    const r = run('all', { mode: 'categories' });
    const club = r.rows[0]!;
    expect(projectsCellTitle(club, null, 'income')).toBe('Доходы: Клуб 1');
    expect(projectsCellTitle(club.children![1]!, club, 'expense')).toBe('Расходы: Клуб 1 → Аренда');
    expect(projectsCellTitle(r.rows[2]!, null, 'total')).toBe('Операции: Клуб 3 (архив)');
    expect(projectsCellTitle(r.total, null, 'total')).toBe('Операции: Всего');
  });
});
