import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getCurrency } from '../../../shared/currencies';
import { formatDateTime, todayInTimezone, zoneOffsetMs } from '../../../shared/dates';
import { convertMinor, DEC_ONE, divDec, roundSignificant, type Dec } from '../../../shared/decimal';
import { nameKey, repairName } from '../../../shared/finmap-format';
import { ACCOUNT_NAME_MAX } from '../../../shared/schemas/accounts';
import type { AccountMapping, ImportCreateItem, ImportPreview, ImportPreviewAccount } from '../../../shared/schemas/imports';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { accounts, currencies, imports, users } from '../../db/schema';
import { AppError } from '../../errors';
import { createLedgerBalances } from '../balances/service';
import { requireCompany } from '../companies/guard';
import type { RatesService } from '../rates/service';
import { groupIssues, isRowError, ISSUE_ROWS_MAX, MESSAGES as M, type RowIssue } from './errors';
import { loadDictionaries, matchDictionaries, type MatchedRow, type PlannedCategory, type PlannedCounterparty, type PlannedNamed, type Ref } from './match';
import { decimalToMinor, type FileAccount, type ImportRow, type ImportType, type ParsedFile } from './parse-row';

/**
 * Предпросмотр импорта (§5 спецификации импорта): сопоставление счетов и справочников с компанией, суммы в валютах
 * счетов, дубликаты, движение и остатки счетов. Ничего не пишет. План записи (ImportPlan) — для POST …/imports (план И-2).
 */

/** Строка, которая будет добавлена: всё сопоставлено, суммы в минимальных единицах. */
export interface PlannedRow {
  row: number;
  type: ImportType;
  paidAt: string;
  accrualDate: string | null;
  account: Ref;
  toAccount: Ref | null;
  amount: number;
  toAmount: number | null;
  baseAmount: number;
  /** Курс для показа (10 значащих цифр). */
  rate: string;
  category: Ref | null;
  counterparty: Ref | null;
  project: Ref | null;
  tags: Ref[];
  comment: string | null;
}

export interface PlannedAccount {
  key: string;
  name: string;
  currency: string;
  startingBalance: number;
  openedAt: string;
}

/** Существующий счёт, который импорт меняет: перенос openedAt и (или) новый startingBalance. */
export interface PlannedAccountChange {
  accountId: number;
  before: { startingBalance: number; openedAt: string };
  after: { startingBalance: number; openedAt: string };
}

export interface ImportPlan {
  /** Добавляемые строки по (paidAt, номер строки): id растут по времени. */
  rows: PlannedRow[];
  accounts: PlannedAccount[];
  accountChanges: PlannedAccountChange[];
  categories: PlannedCategory[];
  counterparties: PlannedCounterparty[];
  projects: PlannedNamed[];
  tags: PlannedNamed[];
}

export interface PreviewSource {
  token: string;
  companyId: number;
  file: { name: string; size: number; sha256: string };
  parsed: ParsedFile;
}

export interface PreviewDeps {
  db: Db;
  rates: RatesService;
  timezone: string;
  now: () => Date;
}

/** Не больше названий в группе «Будет создано». */
export const CREATE_ITEMS_MAX = 200;

/** Минута момента по часам timeZone: «ГГГГ-ММ-ДД ЧЧ:ММ» (ключ дубликата, §5.5). */
export function minuteOf(iso: string, timeZone: string): string {
  const t = Date.parse(iso);
  const local = new Date(t + zoneOffsetMs(t, timeZone)).toISOString();
  return `${local.slice(0, 10)} ${local.slice(11, 16)}`;
}

/** Ключ дубликата (§5.5): тип, счета, минута, сумма, категория, контрагент. */
function dupKey(type: string, accountId: number, toAccountId: number | null, minute: string, amount: number, categoryId: number | null, counterpartyId: number | null): string {
  return [type, accountId, toAccountId ?? '', minute, amount, categoryId ?? '', counterpartyId ?? ''].join('|');
}

const idOf = (r: Ref | null): number | null => (r && 'id' in r ? r.id : null);

type AccountRow = typeof accounts.$inferSelect;

interface AccountState {
  key: string;
  fileName: string;
  mapping: AccountMapping | null;
  /** Валюта известна — суммы строк считаются. */
  currency: string | null;
  /** Ошибок нет — строки попадают в план. */
  ref: Ref | null;
  existing: AccountRow | null;
  archivedHint: boolean;
  errors: { code: string; message: string }[];
}

interface Resolved {
  src: ImportRow;
  acc: AccountState;
  to: AccountState | null;
  amount: number;
  toAmount: number | null;
  baseAmount: number;
  rate: string;
  m: MatchedRow;
}

export function buildPreview(deps: PreviewDeps, src: PreviewSource, requested: AccountMapping[]): { preview: ImportPreview; plan: ImportPlan } {
  const { db, timezone } = deps;
  const companyId = src.companyId;
  const company = requireCompany(db, companyId);
  const base = company.baseCurrency;
  const baseUnits = getCurrency(base).minorUnits;
  const today = todayInTimezone(timezone, deps.now());
  const issues: RowIssue[] = [...src.parsed.issues];

  // ——— счета из файла (§5.4)
  const companyAccounts = db.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.orderIndex), asc(accounts.id)).all();
  const accountsByKey = new Map<string, AccountRow[]>();
  for (const a of companyAccounts) accountsByKey.set(nameKey(a.name), [...(accountsByKey.get(nameKey(a.name)) ?? []), a]);
  const known = new Set(db.select({ code: currencies.code }).from(currencies).all().map((c) => c.code));
  const balances = new Map(createLedgerBalances(db).companyBalances(companyId).map((b) => [b.accountId, b.balance]));
  const requestedByKey = new Map(requested.map((m) => [m.key, m]));
  const states = new Map<string, AccountState>();

  function stateOf(a: FileAccount): AccountState {
    const found = states.get(a.key);
    if (found) return found;
    const same = accountsByKey.get(a.key) ?? [];
    const active = same.filter((x) => !x.archivedAt);
    const byDefault: AccountMapping | null =
      active.length === 1
        ? { key: a.key, kind: 'existing', accountId: active[0]!.id }
        : active.length === 0
          ? { key: a.key, kind: 'new', name: repairName(a.name), currency: base, balance: null }
          : null;
    const mapping = requestedByKey.get(a.key) ?? byDefault;
    const st: AccountState = { key: a.key, fileName: a.name, mapping, currency: null, ref: null, existing: null, archivedHint: same.some((x) => x.archivedAt !== null), errors: [] };
    if (!mapping) st.errors.push({ code: 'A1', message: M.A1(a.name) });
    else if (mapping.kind === 'existing') {
      const acc = companyAccounts.find((x) => x.id === mapping.accountId);
      if (!acc) st.errors.push({ code: 'A1', message: M.A1_MISSING(a.name) });
      else if (acc.archivedAt) st.errors.push({ code: 'A5', message: M.A5(acc.name) });
      else {
        st.currency = acc.currency;
        st.existing = acc;
        st.ref = { id: acc.id };
      }
    } else {
      const name = cleanName(mapping.name);
      if (!name || name.length > ACCOUNT_NAME_MAX) st.errors.push({ code: 'A3', message: M.A3 });
      if (!known.has(mapping.currency)) st.errors.push({ code: 'A2', message: M.A2 });
      else st.currency = mapping.currency;
      if (st.errors.length === 0) st.ref = { key: a.key };
    }
    states.set(a.key, st);
    return st;
  }

  // ——— справочники (§4.5–§4.8)
  const matched = matchDictionaries(loadDictionaries(db, companyId), src.parsed.rows);
  issues.push(...matched.issues);

  // ——— суммы (§4.2): курс на дату — один запрос на пару (валюта, дата)
  const rateCache = new Map<string, { rate: Dec; display: string } | null>();
  function rateOn(currency: string, date: string): { rate: Dec; display: string } | null {
    const k = `${currency}|${date}`;
    if (!rateCache.has(k)) {
      try {
        rateCache.set(k, deps.rates.resolve(companyId, base, currency, date));
      } catch (e) {
        if (!(e instanceof AppError && e.code === 'RATE_UNAVAILABLE')) throw e;
        rateCache.set(k, null);
      }
    }
    return rateCache.get(k)!;
  }

  const resolved: Resolved[] = [];
  for (const r of src.parsed.rows) {
    const acc = stateOf(r.account);
    const to = r.toAccount ? stateOf(r.toAccount) : null;
    const accCurrency = acc.currency;
    const toCurrency = to?.currency ?? null;
    // счёт не выбран или с ошибкой (A1–A3, A5): строки не считаются нигде — ошибка уже в карточке счёта
    if (!accCurrency || !acc.ref || (to && (!toCurrency || !to.ref))) continue;
    const err = (code: RowIssue['code'], message: string) => issues.push({ code, message, row: r.row });
    if (to && idOf(acc.ref) !== null && idOf(acc.ref) === idOf(to.ref)) {
      err('R09', M.R09);
      continue;
    }
    const units = getCurrency(accCurrency).minorUnits;
    const a = decimalToMinor(r.amount, units);
    if (!a) {
      err('R07', M.R07);
      continue;
    }
    if (a.minor === 0) {
      err('R06', M.R06);
      continue;
    }
    if (a.rounded) issues.push({ code: 'W10', message: M.W10(units), row: r.row });

    let baseAmount: number;
    let rate: string;
    if (accCurrency === base) {
      baseAmount = a.minor;
      rate = '1';
      if (r.baseAmount !== null && r.baseAmount !== a.minor) issues.push({ code: 'W9', message: M.W9, row: r.row });
    } else if (r.baseAmount !== null) {
      // курс для показа — F / E с учётом minorUnits (исключение из §4.3 этапа 1)
      baseAmount = r.baseAmount;
      rate = roundSignificant(divDec(BigInt(r.baseAmount) * 10n ** BigInt(units), BigInt(a.minor) * 10n ** BigInt(baseUnits)));
    } else {
      const x = rateOn(accCurrency, r.date);
      if (!x) {
        err('R16', M.R16(accCurrency, r.date));
        continue;
      }
      baseAmount = convertMinor(a.minor, x.rate, units, baseUnits);
      rate = x.display;
      if (!Number.isSafeInteger(baseAmount)) {
        err('R07', M.R07);
        continue;
      }
    }

    // перевод между валютами: сумма зачисления (§4.2)
    let toAmount: number | null = null;
    if (toCurrency) {
      if (toCurrency === accCurrency) toAmount = a.minor;
      else if (toCurrency === base) toAmount = baseAmount;
      else {
        const y = rateOn(toCurrency, r.date);
        if (!y) {
          err('R16', M.R16(toCurrency, r.date));
          continue;
        }
        toAmount = convertMinor(baseAmount, divDec(DEC_ONE, y.rate), baseUnits, getCurrency(toCurrency).minorUnits);
        if (!Number.isSafeInteger(toAmount) || toAmount <= 0) {
          err('R07', M.R07);
          continue;
        }
      }
    }
    const m = matched.rows.get(r.row);
    if (!m) continue; // R17 — уже в замечаниях
    resolved.push({ src: r, acc, to, amount: a.minor, toAmount, baseAmount, rate, m });
  }

  // ——— дубликаты (§5.5): строки, где всё сопоставлено с существующим, против строк неудалённых операций компании
  const candidates = resolved.filter(
    (x) =>
      idOf(x.acc.ref) !== null &&
      (!x.to || idOf(x.to.ref) !== null) &&
      (!x.m.category || idOf(x.m.category) !== null) &&
      (!x.m.counterparty || idOf(x.m.counterparty) !== null),
  );
  const existingCounts = new Map<string, number>();
  if (candidates.length) {
    const ids = [...new Set(candidates.flatMap((x) => [idOf(x.acc.ref)!, ...(x.to ? [idOf(x.to.ref)!] : [])]))];
    const times = candidates.map((x) => Date.parse(x.src.paidAt));
    const from = new Date(times.reduce((p, t) => Math.min(p, t)) - 60_000).toISOString();
    const until = new Date(times.reduce((p, t) => Math.max(p, t)) + 60_000).toISOString();
    const list = sql.join(
      ids.map((x) => sql`${x}`),
      sql`, `,
    );
    const recs = db.all<{
      id: number;
      type: string;
      accountId: number;
      toAccountId: number | null;
      paidAt: string;
      amount: number;
      counterpartyId: number | null;
      lineAmount: number | null;
      categoryId: number | null;
    }>(sql`
      SELECT o.id AS id, o.type AS type, o.account_id AS accountId, o.to_account_id AS toAccountId, o.paid_at AS paidAt,
             o.amount AS amount, o.counterparty_id AS counterpartyId, l.amount AS lineAmount, l.category_id AS categoryId
        FROM operations o LEFT JOIN operation_lines l ON l.operation_id = o.id
       WHERE o.company_id = ${companyId} AND o.deleted_at IS NULL AND o.status = 'actual'
         AND (o.account_id IN (${list}) OR o.to_account_id IN (${list}))
         AND o.paid_at >= ${from} AND o.paid_at < ${until}`);
    const seenTransfers = new Set<number>();
    for (const r of recs) {
      let k: string;
      if (r.type === 'transfer') {
        // перевод — одна запись, без категории и контрагента
        if (seenTransfers.has(r.id)) continue;
        seenTransfers.add(r.id);
        k = dupKey('transfer', r.accountId, r.toAccountId, minuteOf(r.paidAt, timezone), r.amount, null, null);
      } else {
        // разбитая операция — запись на каждую строку: сумма и категория строки
        k = dupKey(r.type, r.accountId, null, minuteOf(r.paidAt, timezone), r.lineAmount ?? r.amount, r.categoryId, r.counterpartyId);
      }
      existingCounts.set(k, (existingCounts.get(k) ?? 0) + 1);
    }
  }
  // кратность: строки файла по порядку, каждая «забирает» одну запись со своим ключом
  const duplicates: number[] = [];
  for (const x of candidates) {
    const k = dupKey(x.src.type, idOf(x.acc.ref)!, x.to ? idOf(x.to.ref) : null, x.src.minute, x.amount, idOf(x.m.category), idOf(x.m.counterparty));
    const left = existingCounts.get(k) ?? 0;
    if (left > 0) {
      existingCounts.set(k, left - 1);
      duplicates.push(x.src.row);
    }
  }
  const dupSet = new Set(duplicates);
  const added = resolved.filter((x) => !dupSet.has(x.src.row));

  // ——— движение, остатки и дата открытия счетов (§5.4): по ключу из файла — для карточки; по id — для существующего
  // счёта, на который могут указывать несколько названий из файла (его дата открытия и стартовый баланс — общие)
  const movement = new Map<string, number>();
  const rowsOf = new Map<string, number>();
  const earliest = new Map<string, string>();
  const movementById = new Map<number, number>();
  const earliestById = new Map<number, string>();
  const touch = (st: AccountState, delta: number, date: string) => {
    movement.set(st.key, (movement.get(st.key) ?? 0) + delta);
    rowsOf.set(st.key, (rowsOf.get(st.key) ?? 0) + 1);
    const e = earliest.get(st.key);
    if (!e || date < e) earliest.set(st.key, date);
    const id = idOf(st.ref);
    if (id !== null) {
      movementById.set(id, (movementById.get(id) ?? 0) + delta);
      const ei = earliestById.get(id);
      if (!ei || date < ei) earliestById.set(id, date);
    }
  };
  for (const x of added) {
    if (x.src.type === 'income') touch(x.acc, x.amount, x.src.date);
    else touch(x.acc, -x.amount, x.src.date);
    if (x.to) touch(x.to, x.toAmount!, x.src.date);
  }

  // существующие счета: перенос даты открытия на первую операцию файла и «Остаток после импорта» — один раз на счёт;
  // разные «Остатки после импорта» у названий, сопоставленных одному счёту, — ошибка этих карточек
  const existingResult = new Map<number, { newOpenedAt: string | null; error: { code: string; message: string } | null }>();
  const accountChanges: PlannedAccountChange[] = [];
  for (const st of states.values()) {
    const acc = st.existing;
    if (!acc || existingResult.has(acc.id)) continue;
    const targets = new Set<number>();
    for (const other of states.values()) {
      if (other.existing?.id === acc.id && other.mapping?.kind === 'existing' && other.mapping.targetBalance != null) targets.add(other.mapping.targetBalance);
    }
    const first = earliestById.get(acc.id) ?? null;
    const newOpenedAt = first !== null && first < acc.openedAt ? first : null;
    if (targets.size > 1) {
      existingResult.set(acc.id, { newOpenedAt, error: { code: 'A4', message: M.A4_TARGETS } });
      continue;
    }
    const target = targets.size === 1 ? [...targets][0]! : null;
    const balance = balances.get(acc.id) ?? acc.startingBalance;
    // «Остаток после импорта»: стартовый баланс = цель - (движение имеющихся операций + движение файла)
    const startingBalance = target === null ? acc.startingBalance : target - (balance - acc.startingBalance + (movementById.get(acc.id) ?? 0));
    if (!Number.isSafeInteger(startingBalance)) {
      existingResult.set(acc.id, { newOpenedAt, error: { code: 'A4', message: M.A4 } });
      continue;
    }
    existingResult.set(acc.id, { newOpenedAt, error: null });
    if (startingBalance !== acc.startingBalance || newOpenedAt !== null) {
      accountChanges.push({
        accountId: acc.id,
        before: { startingBalance: acc.startingBalance, openedAt: acc.openedAt },
        after: { startingBalance, openedAt: newOpenedAt ?? acc.openedAt },
      });
    }
  }

  const planAccounts: ImportPlan['accounts'] = [];
  const cards: ImportPreviewAccount[] = [];
  for (const st of states.values()) {
    const move = movement.get(st.key) ?? 0;
    const first = earliest.get(st.key) ?? null;
    const card: ImportPreviewAccount = {
      key: st.key,
      fileName: st.fileName,
      rows: rowsOf.get(st.key) ?? 0,
      mapping: st.mapping,
      currency: st.currency,
      movement: move,
      archivedHint: st.archivedHint,
      errors: st.errors,
    };
    if (st.existing) {
      const acc = st.existing;
      const result = existingResult.get(acc.id)!;
      card.existing = { balance: balances.get(acc.id) ?? acc.startingBalance, openedAt: acc.openedAt, newOpenedAt: result.newOpenedAt };
      if (result.error) {
        // A4 существующего счёта (решение 18): строки этого названия больше не считаются — как у нового счёта с A4
        st.errors.push(result.error);
        st.ref = null;
      }
    } else if (st.mapping?.kind === 'new' && st.ref) {
      // «Текущий остаток» B: стартовый = B - движение; «Стартовый баланс» S — как есть; пусто — 0
      const b = st.mapping.balance;
      const startingBalance = b === null ? 0 : b.mode === 'current' ? b.amount - move : b.amount;
      if (!Number.isSafeInteger(startingBalance)) {
        // A4: строки счёта больше не считаются (движение в карточке остаётся — по нему видно, откуда ошибка)
        st.errors.push({ code: 'A4', message: M.A4 });
        st.ref = null;
      } else planAccounts.push({ key: st.key, name: cleanName(st.mapping.name), currency: st.currency!, startingBalance, openedAt: first ?? today });
    }
    cards.push(card);
  }
  /** Добавляемые строки: без дубликатов, все счета без ошибок (в том числе A4, найденной выше). */
  const counted = added.filter((x) => x.acc.ref && (!x.to || x.to.ref));

  // ——— W8: этот файл уже импортирован и не отменён
  const prior = db
    .select({ createdAt: imports.createdAt, userName: users.name })
    .from(imports)
    .innerJoin(users, eq(users.id, imports.userId))
    .where(and(eq(imports.companyId, companyId), eq(imports.fileSha256, src.file.sha256), eq(imports.status, 'done')))
    .orderBy(desc(imports.id))
    .get();
  if (prior) issues.push({ code: 'W8', message: M.W8(formatDateTime(prior.createdAt, timezone), prior.userName), row: 0 });

  const rowErrors = issues.filter(isRowError);
  const accountErrors = [...states.values()].reduce((s, st) => s + st.errors.length, 0);
  const planRows: PlannedRow[] = [...counted]
    .sort((p, q) => (p.src.paidAt < q.src.paidAt ? -1 : p.src.paidAt > q.src.paidAt ? 1 : p.src.row - q.src.row))
    .map((x) => ({
      row: x.src.row,
      type: x.src.type,
      paidAt: x.src.paidAt,
      // у перевода нет даты начисления (§4.3); парсер её уже не переносит
      accrualDate: x.src.accrualDate,
      account: x.acc.ref!,
      toAccount: x.to ? x.to.ref : null,
      amount: x.amount,
      toAmount: x.toAmount,
      baseAmount: x.baseAmount,
      rate: x.rate,
      category: x.m.category,
      counterparty: x.m.counterparty,
      project: x.m.project,
      tags: x.m.tags,
      comment: x.src.comment,
    }));
  const dates = counted.map((x) => x.src.date).sort();
  const items = <T>(list: T[], map: (x: T) => ImportCreateItem) => ({ total: list.length, items: list.slice(0, CREATE_ITEMS_MAX).map(map) });
  const byType = (t: ImportType) => src.parsed.rows.filter((r) => r.type === t).length;

  const preview: ImportPreview = {
    token: src.token,
    file: { name: src.file.name, size: src.file.size, rows: src.parsed.total },
    counts: {
      income: byType('income'),
      expense: byType('expense'),
      transfer: byType('transfer'),
      add: counted.length,
      duplicates: duplicates.length,
      skippedFuture: src.parsed.future.length,
    },
    period: dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : null,
    accounts: cards,
    // при ошибках списки могут включать элементы строк с ошибками; когда импорт возможен, они точные
    create: {
      categories: items(matched.categories, (c) => ({ name: c.name, kind: c.kind, ...(c.parentName ? { parent: c.parentName } : {}), rows: c.rows })),
      counterparties: items(matched.counterparties, (c) => ({ name: c.name, type: c.type, rows: c.rows })),
      projects: items(matched.projects, (p) => ({ name: p.name, rows: p.rows })),
      tags: items(matched.tags, (t) => ({ name: t.name, rows: t.rows })),
    },
    errors: { total: rowErrors.length, byCode: groupIssues(rowErrors) },
    warnings: groupIssues(issues.filter((i) => !isRowError(i))),
    duplicates: { count: duplicates.length, rows: duplicates.slice(0, ISSUE_ROWS_MAX) },
    canImport: rowErrors.length === 0 && accountErrors === 0 && counted.length > 0,
  };
  return {
    preview,
    plan: {
      rows: planRows,
      accounts: planAccounts,
      accountChanges,
      categories: matched.categories,
      counterparties: matched.counterparties,
      projects: matched.projects,
      tags: matched.tags,
    },
  };
}
