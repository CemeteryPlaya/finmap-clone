import { describe, expect, it } from 'vitest';
import { accessBanner, syncSummary } from '../../src/client/lib/senet';

/** Баннер доступа и итог ручного забора (план 2026-11-02-senet-autopost, задача 7). */
describe('Senet: баннер и итог забора', () => {
  it('баннер — только при отказе доступа, со ссылкой на «Интеграции»', () => {
    expect(accessBanner(5, { rejected: [] })).toBeNull();
    expect(accessBanner(5, { rejected: [{ connectionId: 1, name: 'Клубы' }] })).toEqual({
      text: 'Обновите доступ к Senet — забор остановлен',
      href: '/c/5/settings/integrations',
    });
  });

  it('итог забора словами', () => {
    expect(syncSummary({ result: 'ok', error: null, counts: { chunks: 3, done: 3, shifts: 4, moves: 9 } })).toBe('Загружено 3 из 3 отрезков: смен 4, выемок и внесений 9');
    expect(syncSummary({ result: 'partial', error: 'Не уложились во время — продолжим через час', counts: { chunks: 3, done: 1, shifts: 1, moves: 2 } })).toBe(
      'Загружено 1 из 3 отрезков: смен 1, выемок и внесений 2. Не уложились во время — продолжим через час',
    );
    expect(syncSummary({ result: 'failed', error: 'Senet не принял данные входа. Обновите их в настройках подключения', counts: { chunks: 0, done: 0 } })).toBe(
      'Senet не принял данные входа. Обновите их в настройках подключения',
    );
  });
});
