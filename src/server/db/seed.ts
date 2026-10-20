import { CURRENCIES } from '../../shared/currencies';
import type { Db } from './client';
import { withTx } from './tx';
import { currencies } from './schema';

export async function seedCurrencies(db: Db): Promise<void> {
  await withTx(db, async (tx) => {
    for (const c of CURRENCIES) {
      await tx
        .insert(currencies)
        .values(c)
        .onConflictDoUpdate({ target: currencies.code, set: { name: c.name, symbol: c.symbol, minorUnits: c.minorUnits } });
    }
  });
}
