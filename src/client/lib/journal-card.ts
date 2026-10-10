import { formatMoney, MONEY_SCREEN } from '../../shared/money';
import type { JournalLookups } from '../components/journal/JournalTable';
import { dayLabel, dayOf, lineDimension, signedMoney, splitLabel, timeLabel } from './journal-format';
import type { JournalItem } from './queries';

/** Текст карточки операции в журнале на телефоне (§7 «Мобильная версия»: сумма, категория, счёт, дата). */
export interface JournalCardText {
  /** Категория: название, «2 категории» у разбитой операции или «Без категории»; у перевода — «Перевод». */
  title: string;
  /** Счёт; у перевода — «Касса → Валютный». */
  account: string;
  /** Контрагент и комментарий через « · »; если нет обоих — null. */
  details: string | null;
  /** Сумма со знаком в валюте счёта. */
  amount: string;
  /** Вторая строка суммы: зачисление перевода в другой валюте («→ 1 $») или сумма в базовой валюте; иначе null. */
  extra: string | null;
  /** «сегодня 10:30», «вчера 09:15», «05.10.2026 18:15» — в поясе приложения. */
  date: string;
}

export function journalCardText(
  item: JournalItem,
  lookups: JournalLookups,
  ctx: { baseCurrency: string; timeZone: string; today: string },
): JournalCardText {
  const account = lookups.accounts.get(item.accountId);
  const toAccount = item.toAccountId === null ? undefined : lookups.accounts.get(item.toAccountId);
  const currency = account?.currency ?? ctx.baseCurrency;

  let title = 'Перевод';
  if (item.type !== 'transfer') {
    const d = lineDimension(item.lines, 'categoryId');
    title = d.kind === 'many' ? splitLabel(d.count, 'category') : d.id === null ? 'Без категории' : (lookups.categories.get(d.id)?.name ?? '…');
  }

  const counterparty = item.counterpartyId === null ? null : (lookups.counterparties.get(item.counterpartyId) ?? '…');
  const details = [counterparty, item.comment].filter((s): s is string => !!s).join(' · ');

  let extra: string | null = null;
  if (item.type === 'transfer' && toAccount && toAccount.currency !== currency && item.toAmount !== null) {
    extra = `→ ${formatMoney(item.toAmount, toAccount.currency, MONEY_SCREEN)}`;
  } else if (currency !== ctx.baseCurrency) {
    extra = formatMoney(item.baseAmount, ctx.baseCurrency, MONEY_SCREEN);
  }

  return {
    title,
    account: item.type === 'transfer' ? `${account?.name ?? '…'} → ${toAccount?.name ?? '…'}` : (account?.name ?? '…'),
    details: details === '' ? null : details,
    amount: signedMoney(item.type, item.amount, currency),
    extra,
    date: `${dayLabel(dayOf(item.paidAt, ctx.timeZone), ctx.today)} ${timeLabel(item.paidAt, ctx.timeZone)}`,
  };
}
