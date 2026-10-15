/** Строка истории цены продажи (§3.1 спецификации «Склад»). */
export interface PricePoint {
  price: number;
  /** Календарная дата `YYYY-MM-DD`, с которой действует цена. */
  validFrom: string;
}

/** Цена на календарную дату: последняя строка с validFrom ≤ date; истории нет или она позже — 0. */
export function priceAt(prices: readonly PricePoint[], date: string): number {
  let best: PricePoint | null = null;
  for (const p of prices) {
    if (p.validFrom <= date && (best === null || p.validFrom > best.validFrom)) best = p;
  }
  return best ? best.price : 0;
}
