/** Δ к прошлому периоду (спецификация «Аналитика клуба», §2.2): текст и цвет. */
export interface Delta {
  text: string;
  tone: 'up' | 'down' | 'flat';
}

/** Знак числа: минус — U+2212, как в остальных суммах. */
function signed(n: number): string {
  if (n > 0) return `+${n}`;
  return n < 0 ? `−${-n}` : '0';
}

/**
 * Δ итоговой цифры: суммы и средние — в процентах с округлением до целого, доли — в процентных пунктах. Без прошлого (или
 * при нуле в прошлом у сумм и средних) Δ нет. Δ сумм при неполных данных в любом из периодов — с «≈»; средние берутся по
 * дням с данными, им «≈» не нужен.
 */
export function delta(cur: number | null, prev: number | null, kind: 'sum' | 'avg' | 'share', approx: boolean): Delta | null {
  if (cur === null || prev === null) return null;
  if (kind === 'share') return result(Math.round((cur - prev) * 100), ' п. п.', '');
  if (prev === 0) return null;
  return result(Math.round(((cur - prev) / Math.abs(prev)) * 100), ' %', approx && kind === 'sum' ? '≈ ' : '');
}

function result(value: number, unit: string, prefix: string): Delta {
  // Math.round(-0.4) — это −0: ноль без знака
  const n = value === 0 ? 0 : value;
  return { text: `${prefix}${signed(n)}${unit}`, tone: n > 0 ? 'up' : n < 0 ? 'down' : 'flat' };
}
