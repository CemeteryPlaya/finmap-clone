import { useQuery } from '@tanstack/react-query';
import type { SenetReviewItemDto, SenetReviewReason } from '../../shared/schemas/senet';
import { normalizeComment } from '../../shared/senet-text';
import { api, type ApiError } from './api';

/** Пункты очереди «Разобрать» (§6, §8.4). */
export function useSenetReview(companyId: number, status: 'open' | 'answered' | 'dismissed' = 'open') {
  return useQuery<SenetReviewItemDto[], ApiError>({
    queryKey: ['senet', companyId, 'review', status],
    queryFn: async () => (await api<{ items: SenetReviewItemDto[] }>(`/companies/${companyId}/senet/review?status=${status}`)).items,
  });
}

export const REVIEW_REASONS: Record<SenetReviewReason, string> = {
  unrecognized: 'Правило не нашлось',
  name_only: 'Только имя сотрудника — вероятно, ЗП',
  salary_no_name: 'ЗП без имени сотрудника',
  rule_broken: 'Правило ссылается на архивную категорию или контрагента',
  no_kaspi: 'В смене нет выноса kaspi',
  negative_cash: 'Касса смены меньше нуля — доходы не проведены',
};

/** Какой ответ ждёт пункт: расход по выемке, сумма Каспи или два дохода. */
export function reviewAnswerKind(reason: SenetReviewReason): 'expense' | 'kaspi' | 'incomes' {
  return reason === 'no_kaspi' ? 'kaspi' : reason === 'negative_cash' ? 'incomes' : 'expense';
}

/** «Запомнить для "{комментарий}"» — у выемки с непустым (после нормализации) комментарием. */
export function canRemember(item: { reason: SenetReviewReason; comment: string | null }): boolean {
  return reviewAnswerKind(item.reason) === 'expense' && normalizeComment(item.comment ?? '') !== '';
}
