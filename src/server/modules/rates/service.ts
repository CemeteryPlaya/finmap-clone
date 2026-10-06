import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { addDays, formatDateRu } from '../../../shared/dates';
import { DEC_ONE, decToString, divDec, parseDecimal, roundSignificant, type Dec } from '../../../shared/decimal';
import type { Db } from '../../db/client';
import { exchangeRates, fixedRates } from '../../db/schema';
import { AppError } from '../../errors';
import { changedFields, mutate } from '../audit/mutate';
import type { AuditService } from '../audit/service';
import { requireCompany } from '../companies/guard';

export type ManualRateRow = typeof exchangeRates.$inferSelect;
export type FixedRateRow = typeof fixedRates.$inferSelect;

export interface FixedRateInput {
  currency: string;
  rate: string;
  validFrom: string;
  validTo: string | null;
}

export interface RatesService {
  /** Курс валюты currency к базовой валюте компании на календарную дату (§4.3). 422 RATE_UNAVAILABLE, если курса нет. */
  resolve(companyId: number, baseCurrency: string, currency: string, date: string): { rate: Dec; display: string };
  /** Курс к тенге на дату: за эту дату или ближайший предыдущий не старше 7 дней; null — нет. */
  kztRate(currency: string, date: string): { rate: Dec; date: string; source: 'nbrk' | 'manual' | 'base' } | null;
  listManual(): ManualRateRow[];
  addManual(input: { date: string; currency: string; rate: string }, userId: number): ManualRateRow;
  updateManual(id: number, rate: string, userId: number): ManualRateRow;
  removeManual(id: number, userId: number): void;
  listFixed(companyId: number): FixedRateRow[];
  addFixed(companyId: number, input: FixedRateInput, userId: number): FixedRateRow;
  updateFixed(companyId: number, id: number, input: Partial<FixedRateInput>, userId: number): FixedRateRow;
  removeFixed(companyId: number, id: number, userId: number): void;
}

/** Окно запасного курса: ближайший предыдущий, но не старше 7 дней (§4.3 п. 5). */
const FALLBACK_DAYS = 7;

const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);
const unavailable = (currency: string, date: string) => new AppError(422, 'RATE_UNAVAILABLE', `Нет курса ${currency} на ${formatDateRu(date)}`);
/** Каноническая запись курса: «475,1200» → «475.12». */
const canonical = (rate: string) => decToString(parseDecimal(rate)!);

export function createRatesService(d: { db: Db; audit: AuditService; now?: () => Date }): RatesService {
  const { db, audit } = d;
  const now = d.now ?? (() => new Date());

  function requireManual(id: number): ManualRateRow {
    const row = db.select().from(exchangeRates).where(and(eq(exchangeRates.id, id), eq(exchangeRates.source, 'manual'))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Курс не найден');
    return row;
  }

  function requireFixed(companyId: number, id: number): FixedRateRow {
    const row = db.select().from(fixedRates).where(and(eq(fixedRates.id, id), eq(fixedRates.companyId, companyId))).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Фиксированный курс не найден');
    return row;
  }

  /** Период фиксированного курса: конец не раньше начала, не пересекается с другими той же валюты в компании. */
  function checkPeriod(companyId: number, v: FixedRateInput, exceptId?: number): void {
    if (v.validTo !== null && v.validTo < v.validFrom) throw invalid({ validTo: 'Дата окончания раньше начала' });
    const clash = db
      .select({ id: fixedRates.id })
      .from(fixedRates)
      .where(
        and(
          eq(fixedRates.companyId, companyId),
          eq(fixedRates.currency, v.currency),
          v.validTo === null ? undefined : lte(fixedRates.validFrom, v.validTo),
          or(isNull(fixedRates.validTo), gte(fixedRates.validTo, v.validFrom)),
        ),
      )
      .all()
      .some((r) => r.id !== exceptId);
    if (clash) throw invalid({ validFrom: 'Период пересекается с другим фиксированным курсом' });
  }

  const svc: RatesService = {
    kztRate(currency, date) {
      if (currency === 'KZT') return { rate: DEC_ONE, date, source: 'base' }; // тенге к тенге — всегда 1, без записи в таблице
      const row = db
        .select()
        .from(exchangeRates)
        .where(and(eq(exchangeRates.currency, currency), lte(exchangeRates.date, date), gte(exchangeRates.date, addDays(date, -FALLBACK_DAYS))))
        .orderBy(desc(exchangeRates.date))
        .limit(1)
        .get();
      return row ? { rate: parseDecimal(row.rateToKzt, 20)!, date: row.date, source: row.source } : null;
    },

    resolve(companyId, baseCurrency, currency, date) {
      if (currency === baseCurrency) return { rate: DEC_ONE, display: '1' };
      const fixed = db
        .select()
        .from(fixedRates)
        .where(
          and(
            eq(fixedRates.companyId, companyId),
            eq(fixedRates.currency, currency),
            lte(fixedRates.validFrom, date),
            or(isNull(fixedRates.validTo), gte(fixedRates.validTo, date)),
          ),
        )
        .get();
      if (fixed) {
        const rate = parseDecimal(fixed.rate, 20)!;
        return { rate, display: roundSignificant(rate) };
      }
      const rx = svc.kztRate(currency, date);
      if (!rx) throw unavailable(currency, date);
      const rb = svc.kztRate(baseCurrency, date);
      if (!rb) throw unavailable(baseCurrency, date);
      const rate = divDec(rx.rate, rb.rate);
      return { rate, display: roundSignificant(rate) };
    },

    listManual() {
      return db
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.source, 'manual'))
        .orderBy(desc(exchangeRates.date), asc(exchangeRates.currency))
        .all();
    },

    addManual(input, userId) {
      if (input.currency === 'KZT') throw invalid({ currency: 'Курс тенге к тенге всегда 1' });
      const exists = db
        .select({ id: exchangeRates.id })
        .from(exchangeRates)
        .where(and(eq(exchangeRates.date, input.date), eq(exchangeRates.currency, input.currency)))
        .get();
      if (exists) throw invalid({ date: 'Курс на эту дату уже есть' });
      return mutate(db, audit, (tx, record) => {
        const row = tx
          .insert(exchangeRates)
          .values({
            date: input.date,
            currency: input.currency,
            rateToKzt: canonical(input.rate),
            source: 'manual',
            createdBy: userId,
            fetchedAt: now().toISOString(),
          })
          .returning()
          .get();
        record({ companyId: null, userId, entity: 'rate', entityId: row.id, action: 'create', diff: { date: row.date, currency: row.currency, rate: row.rateToKzt } });
        return row;
      });
    },

    updateManual(id, rate, userId) {
      const before = requireManual(id);
      const changes = changedFields({ rateToKzt: before.rateToKzt }, { rateToKzt: canonical(rate) });
      if (!changes) return before;
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(exchangeRates).set(changes.after).where(eq(exchangeRates.id, id)).returning().get();
        record({ companyId: null, userId, entity: 'rate', entityId: id, action: 'update', diff: { date: row.date, currency: row.currency, ...changes } });
        return row;
      });
    },

    removeManual(id, userId) {
      const row = requireManual(id);
      mutate(db, audit, (tx, record) => {
        tx.delete(exchangeRates).where(eq(exchangeRates.id, id)).run();
        record({ companyId: null, userId, entity: 'rate', entityId: id, action: 'delete', diff: { date: row.date, currency: row.currency, rate: row.rateToKzt } });
      });
    },

    listFixed(companyId) {
      requireCompany(db, companyId);
      return db
        .select()
        .from(fixedRates)
        .where(eq(fixedRates.companyId, companyId))
        .orderBy(asc(fixedRates.currency), asc(fixedRates.validFrom))
        .all();
    },

    addFixed(companyId, input, userId) {
      const company = requireCompany(db, companyId, { writable: true });
      if (input.currency === company.baseCurrency) throw invalid({ currency: 'Это базовая валюта компании' });
      const v = { ...input, rate: canonical(input.rate) };
      checkPeriod(companyId, v);
      return mutate(db, audit, (tx, record) => {
        const row = tx
          .insert(fixedRates)
          .values({ companyId, currency: v.currency, rate: v.rate, validFrom: v.validFrom, validTo: v.validTo, createdAt: now().toISOString() })
          .returning()
          .get();
        record({ companyId, userId, entity: 'fixed_rate', entityId: row.id, action: 'create', diff: { currency: row.currency, rate: row.rate, validFrom: row.validFrom, validTo: row.validTo } });
        return row;
      });
    },

    updateFixed(companyId, id, input, userId) {
      requireCompany(db, companyId, { writable: true });
      const before = requireFixed(companyId, id);
      const patch = { ...input, ...(input.rate !== undefined ? { rate: canonical(input.rate) } : {}) };
      const changes = changedFields({ rate: before.rate, validFrom: before.validFrom, validTo: before.validTo }, patch);
      if (!changes) return before;
      checkPeriod(companyId, { currency: before.currency, rate: before.rate, validFrom: before.validFrom, validTo: before.validTo, ...changes.after }, id);
      return mutate(db, audit, (tx, record) => {
        const row = tx.update(fixedRates).set(changes.after).where(eq(fixedRates.id, id)).returning().get();
        record({ companyId, userId, entity: 'fixed_rate', entityId: id, action: 'update', diff: { currency: row.currency, ...changes } });
        return row;
      });
    },

    removeFixed(companyId, id, userId) {
      requireCompany(db, companyId, { writable: true });
      const row = requireFixed(companyId, id);
      mutate(db, audit, (tx, record) => {
        tx.delete(fixedRates).where(eq(fixedRates.id, id)).run();
        record({ companyId, userId, entity: 'fixed_rate', entityId: id, action: 'delete', diff: { currency: row.currency, rate: row.rate, validFrom: row.validFrom, validTo: row.validTo } });
      });
    },
  };
  return svc;
}
