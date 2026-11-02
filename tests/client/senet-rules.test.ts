import { describe, expect, it } from 'vitest';
import { historySummary, MATCH_LABELS, moveId, RULE_SECTIONS, ruleSummary } from '../../src/client/lib/senet-rules';

/** «Правила разноски» (спецификация 2026-11-02-senet-autopost, §8.1; план, задача 10). */
describe('экран правил разноски', () => {
  it('секции в порядке спецификации, каждый тип правила — ровно в одной секции', () => {
    expect(RULE_SECTIONS.map((s) => s.title)).toEqual([
      'Сотрудники: алиасы',
      'Слова зарплаты, доплаты, стажёра',
      'Каспи',
      'Мастера',
      'Владельцы и семья',
      'Обед',
      'Ключевые слова',
      'Бар',
      'Точные правила',
    ]);
    const types = RULE_SECTIONS.flatMap((s) => s.parts.map((p) => p.type));
    expect([...types].sort()).toEqual(
      ['bar_item', 'bar_supplier', 'employee_alias', 'exact', 'extra_pay_word', 'kaspi', 'keyword', 'lunch', 'master', 'owner_a_alias', 'owner_word', 'salary_word', 'trainee'].sort(),
    );
    expect(RULE_SECTIONS.flatMap((s) => s.parts).filter((p) => p.ordered).map((p) => p.type)).toEqual(['keyword']);
  });

  it('виды совпадения словами', () => {
    expect(MATCH_LABELS).toEqual({ word: 'слово', first: 'первое слово', phrase: 'фраза целиком', prefix: 'начинается с', contains: 'содержит' });
  });

  it('порядок ключевых слов: выше и ниже, у краёв — без изменений', () => {
    expect(moveId([1, 2, 3], 3, -1)).toEqual([1, 3, 2]);
    expect(moveId([1, 2, 3], 1, 1)).toEqual([2, 1, 3]);
    expect(moveId([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(moveId([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
  });

  it('строка правила: шаблон, вид, категория, контрагент, клуб, комментарий', () => {
    const names = { category: (id: number) => (id === 6 ? 'Вода' : '?'), counterparty: () => 'Поставщик 1', office: () => 'Клуб 1' };
    expect(ruleSummary({ pattern: 'voda', match: 'phrase', categoryId: 6, counterpartyId: null, officeId: null, commentTemplate: 'вода', flags: {} }, names)).toBe(
      '«voda» · фраза целиком → Вода · комментарий «вода»',
    );
    expect(ruleSummary({ pattern: 'sandwich', match: 'contains', categoryId: null, counterpartyId: 3, officeId: 2, commentTemplate: null, flags: {} }, names)).toBe(
      '«sandwich» · содержит → Поставщик 1 · только Клуб 1',
    );
    expect(ruleSummary({ pattern: 'vla', match: 'word', categoryId: null, counterpartyId: 3, officeId: null, commentTemplate: '{orig}', flags: { mistaken: true } }, names)).toBe(
      '«vla» · слово → Поставщик 1 · ошибочный алиас · комментарий — исходный текст',
    );
  });

  it('итог «Проверить на истории»', () => {
    expect(historySummary({ total: 4, recognized: 3, unrecognized: [], differs: [] })).toBe('Распознано 3 из 4');
    expect(historySummary({ total: 4, recognized: 4, unrecognized: [], differs: [{} as never] })).toBe('Распознано 4 из 4 · иначе, чем в журнале: 1');
    expect(historySummary({ total: 0, recognized: 0, unrecognized: [], differs: [] })).toBe('Выемок за период нет');
  });
});
