import { describe, expect, it } from 'vitest';
import { bulkSummary } from '../../src/client/lib/journal-bulk';

describe('итог массового действия (§7)', () => {
  it('«изменено N, пропущено M» и причины с числом операций в порядке первого появления', () => {
    expect(
      bulkSummary('setCategory', {
        changed: [1, 2, 3],
        skipped: [
          { id: 4, reason: 'Разбитая операция — измените её в форме' },
          { id: 5, reason: 'У перевода нет категории' },
          { id: 6, reason: 'Разбитая операция — измените её в форме' },
        ],
      }),
    ).toEqual({
      text: 'Категория: изменено 3, пропущено 3',
      reasons: [
        { reason: 'Разбитая операция — измените её в форме', count: 2 },
        { reason: 'У перевода нет категории', count: 1 },
      ],
    });
    expect(bulkSummary('delete', { changed: [1], skipped: [] })).toEqual({ text: 'Удаление: изменено 1, пропущено 0', reasons: [] });
    expect(bulkSummary('restore', { changed: [], skipped: [{ id: 1, reason: 'Операция не удалена' }] }).text).toBe('Отмена удаления: изменено 0, пропущено 1');
  });
});
