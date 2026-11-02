import { normalize } from './normalize';

/** Строка закупки бара из выемки: `товар × кол-во × цена` (§4.3, тип «Бар»). */
export interface BarLine {
  itemText: string;
  /** Количество × 1000, как у склада. */
  qty: number;
  /** Цена за штуку, тиыны. */
  price: number;
  amount: number;
}

const LINE = /([^\d]+?)\s*(\d+)\s*x\s*(\d+)/g;

/** Все пары «товар кол-во x цена» нормализованного комментария: `sandwich10x500hot dog10x500` — две строки. */
export function parseBarPurchase(comment: string): BarLine[] {
  const out: BarLine[] = [];
  for (const m of normalize(comment).matchAll(LINE)) {
    const itemText = m[1]!.trim();
    if (!itemText) continue;
    const qty = Number(m[2]) * 1000;
    const price = Number(m[3]) * 100;
    out.push({ itemText, qty, price, amount: (qty * price) / 1000 });
  }
  return out;
}

/** Похоже на закупку бара: «кол-во x цена» где-то в комментарии. */
export const looksLikeBarPurchase = (n: string) => /\d+\s*x\s*\d+/.test(n);
