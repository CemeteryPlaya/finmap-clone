/** Целое число из поля ввода: пробелы игнорируются, минус допустим; «1e3», «1.5», «12abc» — ошибка. */
export function parseIntInput(text: string): { ok: true; value: number } | { ok: false; error: string } {
  const s = text.replace(/\s/g, '');
  if (!/^-?\d+$/.test(s)) return { ok: false, error: 'Введите целое число' };
  const value = Number(s);
  if (!Number.isSafeInteger(value)) return { ok: false, error: 'Слишком большое число' };
  return { ok: true, value };
}
