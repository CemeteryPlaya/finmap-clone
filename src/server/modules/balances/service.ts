/** Баланс счёта (§4.7). До шага 4 операций нет — баланс равен стартовому остатку. */
export interface BalancesService {
  accountBalance(account: { id: number; startingBalance: number }): number;
}

export function createBalancesService(): BalancesService {
  return { accountBalance: (a) => a.startingBalance };
}
