import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import type { StockValue } from './stock';

export interface StockPanelRow {
  warehouseId: number;
  name: string;
  /** «₸ 120 000». */
  money: string;
  /** Адрес «Остатков» этого склада (§4.4: щелчок по строке открывает «Остатки» склада). */
  href: string;
  /** В стоимости есть продажи без партии (R9): рядом со стоимостью — предупреждающий знак. */
  hasDeficit: boolean;
}

export interface StockPanel {
  rows: StockPanelRow[];
  /** «Склад: ₸ 120 000» — итог группы; в «Всего на счетах» он не входит. */
  total: string;
}

/** Группа «Склад» левой панели (§4.4 спецификации «Склад»): строка на склад со стоимостью и итог; нет складов — группы нет. */
export function stockPanel(value: StockValue | undefined, companyId: number, currency: string): StockPanel | null {
  if (!value || value.warehouses.length === 0) return null;
  const money = (minor: number) => formatMoney(minor, currency, MONEY_SCREEN_BEFORE);
  return {
    rows: value.warehouses.map((w) => ({
      warehouseId: w.warehouseId,
      name: w.name,
      money: money(w.value),
      href: `/c/${companyId}/stock/balance?warehouse=${w.warehouseId}`,
      hasDeficit: w.hasDeficit,
    })),
    total: `Склад: ${money(value.total)}`,
  };
}
