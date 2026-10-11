import type { OperationType } from './journal-filter';

/**
 * Последние выбранные счета (§6.2, §10.2 этапа 1.5): у дохода и расхода — свой, у перевода — оба. Удобство одного
 * устройства — в localStorage, а не в настройках пользователя; запоминается после успешного создания операции.
 */
export interface LastAccounts {
  income?: number;
  expense?: number;
  transferFrom?: number;
  transferTo?: number;
}

const KEYS = ['income', 'expense', 'transferFrom', 'transferTo'] as const;

export const lastAccountKey = (userId: number, companyId: number): string => `fc.lastAccount.${userId}.${companyId}`;

/** Значение из localStorage: только положительные целые id известных полей; повреждённое — пусто. */
export function parseLastAccounts(raw: string | null): LastAccounts {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: LastAccounts = {};
  for (const key of KEYS) {
    const id = (value as Record<string, unknown>)[key];
    if (typeof id === 'number' && Number.isInteger(id) && id > 0) out[key] = id;
  }
  return out;
}

/** Запомнить счета сохранённой операции. */
export function withSaved(last: LastAccounts, type: OperationType, accountId: number, toAccountId: number | null): LastAccounts {
  if (type === 'transfer') return { ...last, transferFrom: accountId, ...(toAccountId !== null ? { transferTo: toAccountId } : {}) };
  return { ...last, [type]: accountId };
}

/** Счета новой операции: запомненные, если они есть и не в архиве; иначе пусто, как в Finmap (02-L9). */
export function defaultAccounts(
  type: OperationType,
  last: LastAccounts,
  accounts: readonly { id: number; archivedAt: string | null }[],
): { accountId: number | null; toAccountId: number | null } {
  const live = (id: number | undefined) => (id !== undefined && accounts.some((a) => a.id === id && !a.archivedAt) ? id : null);
  if (type === 'transfer') return { accountId: live(last.transferFrom), toAccountId: live(last.transferTo) };
  return { accountId: live(last[type]), toAccountId: null };
}

/** Прочитать память; недоступное хранилище (приватный режим) — пусто. */
export function readLastAccounts(userId: number, companyId: number): LastAccounts {
  try {
    return parseLastAccounts(localStorage.getItem(lastAccountKey(userId, companyId)));
  } catch {
    return {};
  }
}

export function saveLastAccounts(userId: number, companyId: number, last: LastAccounts): void {
  try {
    localStorage.setItem(lastAccountKey(userId, companyId), JSON.stringify(last));
  } catch {
    // без памяти поле счёта просто будет пустым
  }
}
