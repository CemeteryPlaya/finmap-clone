import { CURRENCIES } from '../../shared/currencies';
import type { Db } from './client';
import { currencies } from './schema';

export function seedCurrencies(db: Db): void {
  db.transaction((tx) => {
    for (const c of CURRENCIES) {
      tx.insert(currencies)
        .values(c)
        .onConflictDoUpdate({ target: currencies.code, set: { name: c.name, symbol: c.symbol, minorUnits: c.minorUnits } })
        .run();
    }
  });
}
