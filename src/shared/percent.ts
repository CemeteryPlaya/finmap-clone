/** «33,33» / «33.3» / «50 %» → сотые доли процента (bp): 3333 / 3330 / 5000. null — не число или больше двух знаков. */
export function parsePercentToBp(text: string): number | null {
  const s = text.replace(/\s/g, '').replace(/%$/, '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(bp) ? bp : null;
}

/** Сотые доли процента → «33,33», «33,3», «50». */
export function formatBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(bp % 100);
  if (frac === 0) return String(whole);
  return `${whole},${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}
