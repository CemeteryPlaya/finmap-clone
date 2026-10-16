import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  arcPath,
  barSpan,
  compactMoney,
  donutArcs,
  donutSlices,
  labelEvery,
  linePath,
  niceScale,
  OTHER_ID,
  reportChart,
  sliceShare,
  stackColumn,
  stackExtent,
  stackSeries,
  yOf,
} from '../../src/client/lib/charts';
import type { ReportRow } from '../../src/shared/report-engine';

const row = (id: string, label: string, values: number[]): ReportRow => ({ id, kind: 'category', label, values, total: values.reduce((s, v) => s + v, 0) });

describe('шкала оси Y (§4.2)', () => {
  it('положительные значения: от нуля до круглого верха, 3–5 делений с шагом 1, 2, 2,5 или 5 × 10ⁿ', () => {
    expect(niceScale([120_000_00, 95_000_00, 3_000_00])).toEqual({ min: 0, max: 15_000_000, ticks: [0, 5_000_000, 10_000_000, 15_000_000] });
    expect(niceScale([9_000_000]).ticks).toEqual([0, 2_500_000, 5_000_000, 7_500_000, 10_000_000]);
  });

  it('отрицательные значения: ноль внутри шкалы, низ — круглое отрицательное', () => {
    const s = niceScale([500_000, -320_000, 100_000]);
    expect(s.min).toBeLessThan(0);
    expect(s.min).toBeLessThanOrEqual(-320_000);
    expect(s.max).toBeGreaterThanOrEqual(500_000);
    expect(s.ticks).toContain(0);
    // все отрицательные — верх шкалы на нуле
    expect(niceScale([-5000, -100]).max).toBe(0);
  });

  it('все нули и пусто — ось только с нулём, столбцы нулевой высоты, без деления на ноль', () => {
    for (const values of [[0, 0, 0], []]) {
      const s = niceScale(values);
      expect(s).toEqual({ min: 0, max: 1, ticks: [0] });
      expect(barSpan(s, 0, 200)).toEqual({ y: 200, h: 0 });
    }
  });

  it('деления — целые минимальные единицы даже на маленьких суммах', () => {
    for (const t of niceScale([3, -2]).ticks) expect(Number.isInteger(t)).toBe(true);
    expect(niceScale([1]).ticks).toEqual([0, 1]);
  });

  it('координаты: ноль внизу у положительной шкалы; отрицательный столбец уходит вниз от нуля', () => {
    const s = { min: -100, max: 300, ticks: [] };
    expect(yOf(s, 300, 400)).toBe(0);
    expect(yOf(s, -100, 400)).toBe(400);
    expect(barSpan(s, 200, 400)).toEqual({ y: 100, h: 200 });
    expect(barSpan(s, -50, 400)).toEqual({ y: 300, h: 50 });
  });

  it('подписи оси: млн, тыс, без символа валюты, минус U+2212', () => {
    expect(compactMoney(1_200_000_000, 'KZT')).toBe('12\u00A0млн');
    expect(compactMoney(150_000_000, 'KZT')).toBe('1,5\u00A0млн');
    expect(compactMoney(-50_000_000, 'KZT')).toBe('\u2212500\u00A0тыс');
    expect(compactMoney(75_000, 'KZT')).toBe('750');
    expect(compactMoney(0, 'KZT')).toBe('0');
    expect(compactMoney(300_000_000_000, 'KZT')).toBe('3\u00A0млрд');
  });

  it('подписи колонок прореживаются по ширине; линия через точки', () => {
    expect(labelEvery(12, 1200)).toBe(1);
    expect(labelEvery(92, 300)).toBe(18);
    expect(labelEvery(0, 300)).toBe(1);
    expect(linePath([{ x: 1, y: 2 }, { x: 3.25, y: 4 }])).toBe('M1.0 2.0 L3.3 4.0');
    expect(linePath([])).toBe('');
  });
});

describe('кольцо: не больше 8 частей, «Прочие» (§4.2)', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(`expense:category:${i + 1}`, `Категория ${i + 1}`, [(i + 1) * 100]));

  it('до 8 частей — все; нулевые и отрицательные не рисуются, цвет — по месту строки в отчёте (не среди показанных)', () => {
    const slices = donutSlices([row('a', 'Бар', [500]), row('b', 'Возвраты', [-100]), row('c', 'Пусто', [0]), row('d', 'Аренда', [300])]);
    expect(slices.map((s) => [s.id, s.value, s.color])).toEqual([
      ['a', 500, 0],
      ['d', 300, 3],
    ]);
    expect(sliceShare(slices[0]!, slices)).toBe('62,50\u00A0%');
  });

  it('больше 8 — семь крупнейших по порядку отчёта и «Прочие» с суммой остальных', () => {
    const slices = donutSlices(rows);
    expect(slices).toHaveLength(8);
    expect(slices.slice(0, 7).map((s) => s.label)).toEqual(['Категория 4', 'Категория 5', 'Категория 6', 'Категория 7', 'Категория 8', 'Категория 9', 'Категория 10']);
    // строки 4…10 отчёта (индексы 3…9) — цвет по модулю палитры
    expect(slices.slice(0, 7).map((s) => s.color)).toEqual([3, 4, 5, 6, 7, 0, 1]);
    expect(slices[7]).toEqual({ id: OTHER_ID, label: 'Прочие', value: 600, color: 'other' });
    // ровно 8 — без «Прочих»
    expect(donutSlices(rows.slice(0, 8)).map((s) => s.id)).not.toContain(OTHER_ID);
  });

  it('нулевая строка выше не перекрашивает остальные: цвет строки не зависит от периода', () => {
    const colors = (first: number) => Object.fromEntries(donutSlices([row('a', 'А', [first]), row('b', 'Б', [200]), row('c', 'В', [300])]).map((s) => [s.id, s.color]));
    expect(colors(100)).toEqual({ a: 0, b: 1, c: 2 });
    expect(colors(0)).toEqual({ b: 1, c: 2 });
  });

  it('смена состава семёрки не перекрашивает строки без конфликта; цвет в стеке тот же, что в кольце', () => {
    const make = (v1: number) => [row('r0', 'Р0', [v1]), ...Array.from({ length: 8 }, (_, i) => row('r' + (i + 1), 'Р' + (i + 1), [(i + 2) * 100]))];
    const byId = (rs: ReportRow[]) => Object.fromEntries(donutSlices(rs).map((s) => [s.id, s.color]));
    const small = byId(make(10)); // r0 уходит в «Прочие»
    const big = byId(make(5000)); // r0 входит в семёрку, вытесняя r2
    expect(small.other).toBe('other');
    for (const id of ['r3', 'r4', 'r5', 'r6', 'r7']) expect(small[id]).toBe(big[id]);
    expect(big.r0).toBe(0);
    const rs = make(5000);
    const slices = donutSlices(rs);
    expect(stackSeries(rs, slices, 1).map((s) => s.color)).toEqual(slices.map((s) => s.color));
  });

  it('строки 0 и 8 показаны вместе: вторая берёт следующий свободный цвет, а не цвет первой; в стеке цвета те же', () => {
    const rs = Array.from({ length: 10 }, (_, i) => row('r' + i, 'Р' + i, [i === 0 || i === 8 ? 5000 : 100 + i]));
    const slices = donutSlices(rs);
    const byId = Object.fromEntries(slices.map((s) => [s.id, s.color]));
    expect(slices.map((s) => s.id)).toEqual(expect.arrayContaining(['r0', 'r8']));
    expect(byId.r0).toBe(0);
    expect(byId.r8).not.toBe(byId.r0);
    expect(stackSeries(rs, slices, 1).map((s) => s.color)).toEqual(slices.map((s) => s.color));
  });

  it('цвета показанных частей всегда разные (кроме «Прочих») при любом числе строк и значений; цвет - из палитры', () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32;
      return seed / 2 ** 32;
    };
    for (let n = 1; n <= 24; n++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const rs = Array.from({ length: n }, (_, i) => row('r' + i, 'Р' + i, [next() < 0.2 ? 0 : Math.floor(next() * 1000)]));
        const slices = donutSlices(rs);
        const colors = slices.filter((s) => s.id !== OTHER_ID).map((s) => s.color);
        expect(new Set(colors).size, `n=${n}`).toBe(colors.length);
        for (const c of colors) expect(typeof c === 'number' && c >= 0 && c < 8).toBe(true);
        expect(slices.length).toBeLessThanOrEqual(8);
        for (const s of slices.filter((x) => x.id === OTHER_ID)) expect(s.color).toBe('other');
      }
    }
  });

  it('max больше палитры не зацикливает подбор цвета: частей не больше 8, цвета разные', () => {
    const rs = Array.from({ length: 20 }, (_, i) => row('r' + i, 'Р' + i, [100 + i]));
    const slices = donutSlices(rs, 50);
    expect(slices).toHaveLength(8);
    const colors = slices.filter((s) => s.id !== OTHER_ID).map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('секторы: доли угла по значениям; одна часть — полный круг двумя дугами', () => {
    const arcs = donutArcs([{ id: 'a', label: 'А', value: 100, color: 0 }], 90, 90, 80, 50);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.d.match(/A80 80/g)).toHaveLength(2);
    expect(arcPath(0, 0, 10, 5, 0, Math.PI / 2)).toBe('M0.00 -10.00 A10 10 0 0 1 10.00 0.00 L5.00 0.00 A5 5 0 0 0 0.00 -5.00 Z');
    expect(donutArcs([], 90, 90, 80, 50)).toEqual([]);
  });
});

describe('стек по колонкам (§4.2)', () => {
  it('ряды — части кольца; «Прочие» — сумма остальных строк по колонкам, включая отрицательные', () => {
    const rows = [row('a', 'А', [300, 0]), row('b', 'Б', [100, 20]), row('c', 'В', [-50, 10]), row('d', 'Г', [30, 5])];
    const slices = donutSlices(rows, 2);
    expect(slices.map((s) => s.id)).toEqual(['a', OTHER_ID]);
    const series = stackSeries(rows, slices, 2);
    expect(series.map((s) => [s.id, s.values])).toEqual([
      ['a', [300, 0]],
      [OTHER_ID, [80, 35]],
    ]);
  });

  it('положительные — вверх от нуля, отрицательные — вниз; нули пропускаются; шкала по высоте стеков', () => {
    const series = [
      { id: 'a', label: 'А', color: 0 as const, values: [300, 0] },
      { id: 'b', label: 'Б', color: 1 as const, values: [-100, 50] },
      { id: 'c', label: 'В', color: 2 as const, values: [200, -20] },
    ];
    expect(stackColumn(series, 0)).toEqual([
      { id: 'a', color: 0, from: 0, to: 300 },
      { id: 'b', color: 1, from: 0, to: -100 },
      { id: 'c', color: 2, from: 300, to: 500 },
    ]);
    expect(stackExtent(series, 2)).toEqual([500, -100, 50, -20]);
  });
});

describe('данные графиков из ответа отчёта (§4.2, §5.2)', () => {
  it('столбцы групп, линия — их разница по колонкам (не накопительно), строки разреза групп', () => {
    const income = { ...row('income', 'Доходы', [1000, 0, 500]), kind: 'group' as const, children: [row('income:category:1', 'Бар', [1000, 0, 500])] };
    const expense = { ...row('expense', 'Расходы', [300, 400, 0]), kind: 'group' as const, children: [row('expense:stock:cogs', 'Себестоимость проданных товаров', [300, 400, 0])] };
    const chart = reportChart([row('profit', 'Прибыль', [700, -400, 500]), income, expense], 3);
    expect(chart.income).toEqual([1000, 0, 500]);
    expect(chart.expense).toEqual([300, 400, 0]);
    expect(chart.line).toEqual([700, -400, 500]);
    expect(chart.expenseRows.map((r) => r.id)).toEqual(['expense:stock:cogs']);
    // пустой ответ — нули
    expect(reportChart([], 2)).toEqual({ income: [0, 0], expense: [0, 0], line: [0, 0], incomeRows: [], expenseRows: [] });
  });
});

describe('цвета графиков — только токены темы', () => {
  it('в компонентах графиков нет цветов литералами (#…, rgb(…)): тёмная тема переопределит токены', () => {
    const dir = path.resolve('src/client/components/charts');
    const files = fs.readdirSync(dir);
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(text, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
    const css = fs.readFileSync(path.resolve('src/client/styles.css'), 'utf8');
    for (const token of ['chart-expense', 'chart-line', 'chart-1', 'chart-8', 'chart-other']) expect(css).toContain(`--color-${token}:`);
  });
});
