import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRAND_COLORS } from '../../src/shared/brand';

const css = fs.readFileSync('src/client/styles.css', 'utf8');
const html = fs.readFileSync('src/client/index.html', 'utf8');

/** Значение токена Tailwind `--color-<name>` из styles.css. */
const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1]?.toLowerCase();

describe('цвета бренда для PWA', () => {
  it('совпадают с токенами Tailwind (§7: цвета в одном месте)', () => {
    expect(token('chrome')).toBe(BRAND_COLORS.chrome);
    expect(token('income')).toBe(BRAND_COLORS.income);
    expect(token('income-soft')).toBe(BRAND_COLORS.incomeSoft);
  });

  it('index.html: цвет темы, манифест, иконки вкладки и iOS', () => {
    expect(html).toContain(`<meta name="theme-color" content="${BRAND_COLORS.chrome}" />`);
    expect(html).toContain('<link rel="manifest" href="/pwa/manifest.webmanifest" crossorigin="use-credentials" />');
    expect(html).toContain('<link rel="icon" href="/pwa/icon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png" />');
    // офлайн-режима нет (§7): service worker не регистрируется
    expect(html).not.toContain('serviceWorker');
  });
});
