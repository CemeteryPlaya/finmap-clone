import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync('src/client/styles.css', 'utf8');

function color(name: string): string {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!m) throw new Error(`Нет цвета --color-${name}`);
  return m[1]!;
}

/** Относительная яркость и контраст по WCAG 2.x. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('цвета текста — контраст не меньше 4,5:1 (§11 этапа 1.5)', () => {
  it('expense-strong — на белом, на expense-soft и на field (итоги 1.5-3b №1)', () => {
    for (const bg of ['card', 'expense-soft', 'field']) expect(contrast(color('expense-strong'), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('income-strong — на белом и на income-soft', () => {
    for (const bg of ['card', 'income-soft']) expect(contrast(color('income-strong'), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('expense для мелкого текста не годится, поэтому текст расхода — только expense-strong', () => {
    expect(contrast(color('expense'), color('card'))).toBeLessThan(4.5);
    const offenders = sources('src/client').flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (/\btext-expense(?![-\w])/.test(line) ? [`${file}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
