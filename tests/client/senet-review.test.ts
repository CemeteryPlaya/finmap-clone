import { describe, expect, it } from 'vitest';
import { canRemember, REVIEW_REASONS, reviewAnswerKind } from '../../src/client/lib/senet-review';

/** Карточка пункта «Разобрать» (спецификация 2026-11-02-senet-autopost, §8.4; план, задача 12). */
describe('очередь «Разобрать»: карточка', () => {
  it('причины словами', () => {
    expect(REVIEW_REASONS).toEqual({
      unrecognized: 'Правило не нашлось',
      name_only: 'Только имя сотрудника — вероятно, ЗП',
      salary_no_name: 'ЗП без имени сотрудника',
      rule_broken: 'Правило ссылается на архивную категорию или контрагента',
      no_kaspi: 'В смене нет выноса kaspi',
      negative_cash: 'Касса смены меньше нуля — доходы не проведены',
    });
  });

  it('вид ответа по причине; «Запомнить» — только для выемки с непустым комментарием', () => {
    expect(reviewAnswerKind('unrecognized')).toBe('expense');
    expect(reviewAnswerKind('rule_broken')).toBe('expense');
    expect(reviewAnswerKind('no_kaspi')).toBe('kaspi');
    expect(reviewAnswerKind('negative_cash')).toBe('incomes');
    expect(canRemember({ reason: 'unrecognized', comment: 'вода' })).toBe(true);
    expect(canRemember({ reason: 'unrecognized', comment: ' !! ' })).toBe(false);
    expect(canRemember({ reason: 'no_kaspi', comment: null })).toBe(false);
  });
});
