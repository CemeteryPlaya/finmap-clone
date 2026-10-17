import { formatDateShortRu } from '../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import { statementLeg, transferLabel } from '../../shared/report-statement';
import type { JournalLookups } from '../components/journal/JournalTable';
import { dayOf, deltaMoney, lineDimension, signedMoney, splitLabel } from './journal-format';
import type { JournalItem } from './queries';

/** Текст карточки операции в журнале на телефоне (§8.4 этапа 1.5, как в Finmap). */
export interface JournalCardText {
  /** Строка 1 слева: дата «27 сент. 2026» без времени, в поясе приложения. */
  date: string;
  /** Строка 1 справа: сумма со знаком в валюте счёта. */
  amount: string;
  /** Мелко под суммой: зачисление перевода в другой валюте («→ 1 $») или сумма в базовой валюте; иначе null. */
  extra: string | null;
  /** Строка 2: контрагент; нет — null (пустой строки нет). */
  counterparty: string | null;
  /** Строка 3: счёт; у перевода — «Касса → Kaspi». */
  account: string;
  /** Строка 4 мелко: категория, «2 категории» у разбитой, «Без категории»; у перевода — null (решение владельца 1, §14.3). */
  category: string | null;
}

/** Подпись категории: «2 категории» у разбитой, «Без категории», иначе имя. */
function categoryText(d: ReturnType<typeof lineDimension>, lookups: JournalLookups): string {
  if (d.kind === 'many') return splitLabel(d.count, 'category');
  return d.id === null ? 'Без категории' : (lookups.categories.get(d.id)?.name ?? '…');
}

/**
 * statementAccountId — карточка «Выписки по счету» (§6 спецификации «Аналитика»): сумма — движение по этому счёту в его
 * валюте со знаком, строка счёта — «Остаток: …» после операции, у перевода категория — «Перевод: {другой счёт}».
 */
export function journalCardText(item: JournalItem, lookups: JournalLookups, ctx: { baseCurrency: string; timeZone: string; statementAccountId?: number }): JournalCardText {
  const account = lookups.accounts.get(item.accountId);
  const toAccount = item.toAccountId === null ? undefined : lookups.accounts.get(item.toAccountId);
  const currency = account?.currency ?? ctx.baseCurrency;
  if (ctx.statementAccountId !== undefined) {
    const leg = statementLeg(item, ctx.statementAccountId);
    const own = lookups.accounts.get(ctx.statementAccountId);
    const ownCurrency = own?.currency ?? ctx.baseCurrency;
    const d = lineDimension(item.lines, 'categoryId');
    return {
      date: formatDateShortRu(dayOf(item.paidAt, ctx.timeZone)),
      amount: deltaMoney(leg.delta, ownCurrency),
      extra: null,
      counterparty: item.counterpartyId === null ? null : (lookups.counterparties.get(item.counterpartyId) ?? '…'),
      account: leg.balance === null ? (own?.name ?? '…') : `Остаток: ${formatMoney(leg.balance, ownCurrency, MONEY_SCREEN)}`,
      category: leg.other !== null ? transferLabel(lookups.accounts.get(leg.other)?.name ?? '…') : categoryText(d, lookups),
    };
  }

  let category: string | null = null;
  if (item.type !== 'transfer') {
    const d = lineDimension(item.lines, 'categoryId');
    category = categoryText(d, lookups);
  }

  let extra: string | null = null;
  if (item.type === 'transfer' && toAccount && toAccount.currency !== currency && item.toAmount !== null) {
    extra = `→ ${formatMoney(item.toAmount, toAccount.currency, MONEY_SCREEN)}`;
  } else if (currency !== ctx.baseCurrency) {
    extra = formatMoney(item.baseAmount, ctx.baseCurrency, MONEY_SCREEN);
  }

  return {
    date: formatDateShortRu(dayOf(item.paidAt, ctx.timeZone)),
    amount: signedMoney(item.type, item.amount, currency),
    extra,
    counterparty: item.counterpartyId === null ? null : (lookups.counterparties.get(item.counterpartyId) ?? '…'),
    account: item.type === 'transfer' ? `${account?.name ?? '…'} → ${toAccount?.name ?? '…'}` : (account?.name ?? '…'),
    category,
  };
}
