import { useQuery } from '@tanstack/react-query';
import { addDays, todayInTimezone } from '../../shared/dates';
import { api, type ApiError } from './api';

export type ShiftState = 'ok' | 'open' | 'not_posted' | 'off' | 'cash_diff' | 'review' | 'changed' | 'deposit_mismatch';

export interface ShiftRow {
  id: number;
  officeId: number;
  openedAt: string;
  closedAt: string | null;
  cashier: string;
  revenue: number;
  revenueTx: number | null;
  kaspi: { posted: number; senet: number };
  cash: { posted: number; senet: number };
  moves: { posted: number; total: number; queued: number };
  cashAfter: { senet: number; journal: number } | null;
  states: ShiftState[];
}

export interface ShiftList {
  rows: ShiftRow[];
  totals: { revenue: number; kaspi: { posted: number; senet: number }; cash: { posted: number; senet: number } };
  firstCashDiffId: number | null;
}

export interface ShiftDetail extends Omit<ShiftRow, 'moves'> {
  moves: { id: number; at: string; kind: 'in' | 'out'; amount: number; comment: string; ruleId: number | null; operationId: number | null; noRepost: boolean; missingInSenet: boolean }[];
  movesSummary: ShiftRow['moves'];
  incomes: { kind: 'kaspi' | 'cash'; amount: number; operationId: number | null; noRepost: boolean }[];
  warnings: string[];
}

export const SHIFT_STATE_TEXT: Record<ShiftState, string> = {
  ok: 'Сходится',
  open: 'Идёт',
  not_posted: 'Не проводится',
  off: 'Клуб выключен — не проводится',
  cash_diff: 'Касса расходится',
  review: 'Разобрать',
  changed: 'Senet изменил смену после проведения',
  deposit_mismatch: 'Внесение ≠ остаток прошлой смены',
};

/** Вкладка «Сверка Senet» — у компании есть хотя бы одно подключение (С15§6.1). */
export const senetTabVisible = (connections: readonly unknown[] | undefined) => (connections?.length ?? 0) > 0;

/** Подпись смены — общая с сервером (отчёт «Выручка клуба» по сменам). */
export { shiftPeriodLabel } from '../../shared/senet-text';

/** Период по умолчанию — текущий месяц по часам клуба. */
export function defaultPeriod(now: Date, timeZone: string): { from: string; to: string } {
  const today = todayInTimezone(timeZone, now);
  const from = `${today.slice(0, 8)}01`;
  const next = addDays(`${today.slice(0, 7)}-28`, 4);
  return { from, to: addDays(`${next.slice(0, 8)}01`, -1) };
}

export function useSenetShifts(companyId: number, q: { project: number | null; from: string; to: string; onlyDiff: boolean }, fromIso: string, toIso: string) {
  const params = new URLSearchParams({ from: fromIso, to: toIso, onlyDiff: q.onlyDiff ? '1' : '0' });
  if (q.project) params.set('project', String(q.project));
  return useQuery<ShiftList, ApiError>({
    queryKey: ['senet', companyId, 'shifts', params.toString()],
    queryFn: () => api(`/companies/${companyId}/senet/shifts?${params}`),
  });
}

export function useSenetShift(companyId: number, shiftId: number | null) {
  return useQuery<ShiftDetail, ApiError>({
    queryKey: ['senet', companyId, 'shift', shiftId],
    queryFn: () => api(`/companies/${companyId}/senet/shifts/${shiftId}`),
    enabled: shiftId !== null,
  });
}
