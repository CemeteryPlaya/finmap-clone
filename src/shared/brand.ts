/**
 * Цвета бренда для PWA: манифест, иконки и `<meta name="theme-color">`. Это те же значения, что токены
 * Tailwind в `src/client/styles.css` (§7: цвета заданы в одном месте), — совпадение проверяет
 * `tests/shared/brand.test.ts`: поменяли токен — тест подскажет поменять и здесь.
 */
export const BRAND_COLORS = {
  /** `--color-chrome`: графитовая шапка; фон иконки, цвет темы и фон заставки PWA. */
  chrome: '#16181d',
  /** `--color-income`: зелёный — столбики иконки. */
  income: '#0f9d6b',
  /** `--color-income-soft`: светло-зелёный — старший столбик иконки. */
  incomeSoft: '#dff5ec',
} as const;
