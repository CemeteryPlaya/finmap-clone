import type { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/server/db/client';

/**
 * Пул соединений Neon (план 2026-10-20-vercel-postgres, итоговое ревью): обрыв простаивающего соединения (Neon уснул,
 * WebSocket закрылся по сроку) пул сообщает событием error — без обработчика оно роняет процесс функции.
 */
describe('пул Neon', () => {
  it('ошибка простаивающего соединения уходит в журнал, процесс живёт', async () => {
    const errors: unknown[] = [];
    // к адресу не подключаемся: пул ленивый, соединение открылось бы только на первом запросе
    const o = await openDatabase({ kind: 'neon', url: 'postgres://u:p@127.0.0.1:1/db' }, { onPoolError: (e) => errors.push(e) });
    try {
      const pool = (o.db as unknown as { $client: EventEmitter }).$client;
      expect(pool.listenerCount('error')).toBeGreaterThan(0);
      expect(() => pool.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
      expect(errors).toEqual([new Error('Connection terminated unexpectedly')]);
    } finally {
      await o.close();
    }
  });
});
