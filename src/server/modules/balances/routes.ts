import type { FastifyInstance } from 'fastify';
import { getCurrency } from '../../../shared/currencies';
import { todayInTimezone } from '../../../shared/dates';
import { convertMinor } from '../../../shared/decimal';
import { AppError } from '../../errors';
import { parseId } from '../../http/params';
import type { CompaniesService, CompanyRow } from '../companies/service';
import type { RatesService } from '../rates/service';
import type { LedgerBalances } from './service';

export interface CompanyTotal {
  currency: string;
  amount: number;
  /** Валюты, по которым нет курса на сегодня: их счета не вошли в итог. */
  unavailable: string[];
}

export function registerBalancesRoutes(
  app: FastifyInstance,
  deps: { companies: CompaniesService; ledger: LedgerBalances; rates: RatesService; timezone: string; now?: () => Date },
): void {
  const now = deps.now ?? (() => new Date());

  /** «Всего на счетах» (§4.7): неархивные счета в базовой валюте по курсу на сегодня. */
  function total(company: CompanyRow): CompanyTotal {
    const sums = new Map<string, number>();
    for (const b of deps.ledger.companyBalances(company.id)) {
      if (!b.archived) sums.set(b.currency, (sums.get(b.currency) ?? 0) + b.balance);
    }
    const today = todayInTimezone(deps.timezone, now());
    const baseMinor = getCurrency(company.baseCurrency).minorUnits;
    let amount = 0;
    const unavailable = new Set<string>();
    for (const [currency, sum] of sums) {
      if (sum === 0) continue; // пустой счёт без курса не должен вечно показывать «курс недоступен»
      try {
        const { rate } = deps.rates.resolve(company.id, company.baseCurrency, currency, today);
        amount += convertMinor(sum, rate, getCurrency(currency).minorUnits, baseMinor);
      } catch (e) {
        if (!(e instanceof AppError && e.code === 'RATE_UNAVAILABLE')) throw e;
        // нет курса либо самой валюты, либо базовой: называем ту, которой действительно не хватает
        unavailable.add(deps.rates.kztRate(currency, today) ? company.baseCurrency : currency);
      }
    }
    return { currency: company.baseCurrency, amount, unavailable: [...unavailable].sort() };
  }

  app.get('/api/v1/companies/summary', async () => ({
    companies: deps.companies
      .list()
      .filter((c) => !c.archivedAt)
      .map((c) => ({ id: c.id, name: c.name, total: total(c) })),
  }));

  app.get<{ Params: { cid: string } }>('/api/v1/companies/:cid/balances', async (req) => {
    const company = deps.companies.require(parseId(req.params.cid));
    return {
      accounts: deps.ledger.companyBalances(company.id).map(({ accountId, currency, balance }) => ({ accountId, currency, balance })),
      total: total(company),
    };
  });
}
