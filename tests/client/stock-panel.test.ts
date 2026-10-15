import { describe, expect, it } from 'vitest';
import { stockPanel } from '../../src/client/lib/stock-panel';

describe('stockPanel (§4.4)', () => {
  it('строка на склад со стоимостью, адрес «Остатков» склада и итог «Склад: ₸ X»', () => {
    const panel = stockPanel(
      {
        warehouses: [
          { warehouseId: 3, projectId: 1, name: 'Бар Клуб 1', value: 12_000_000, hasDeficit: false },
          { warehouseId: 4, projectId: 2, name: 'Бар Клуб 2', value: 0, hasDeficit: true },
        ],
        total: 12_000_000,
      },
      7,
      'KZT',
    );
    expect(panel).toEqual({
      rows: [
        { warehouseId: 3, name: 'Бар Клуб 1', money: '₸\u00A0120\u202F000', href: '/c/7/stock/balance?warehouse=3', hasDeficit: false },
        { warehouseId: 4, name: 'Бар Клуб 2', money: '₸\u00A00', href: '/c/7/stock/balance?warehouse=4', hasDeficit: true },
      ],
      total: 'Склад: ₸\u00A0120\u202F000',
    });
  });

  it('нет данных или нет складов — группы нет', () => {
    expect(stockPanel(undefined, 7, 'KZT')).toBeNull();
    expect(stockPanel({ warehouses: [], total: 0 }, 7, 'KZT')).toBeNull();
  });
});
