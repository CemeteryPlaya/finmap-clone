import { QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';

describe('⟳ «Обновить» (§2.5 этапа 1.5)', () => {
  afterEach(async () => {
    const { queryClient } = await import('../../src/client/lib/query');
    queryClient.clear();
  });

  it('перечитывает активный журнал; удачно — без ошибки', async () => {
    const { queryClient } = await import('../../src/client/lib/query');
    const { refreshOperations } = await import('../../src/client/lib/journal-mutations');
    let calls = 0;
    const observer = new QueryObserver(queryClient, { queryKey: ['journal', 991, 'q'], queryFn: async () => ++calls, retry: false });
    const stop = observer.subscribe(() => undefined);
    await expect.poll(() => calls).toBe(1);
    await expect(refreshOperations(991)).resolves.toBeUndefined();
    expect(calls).toBe(2);
    stop();
  });

  it('сбой перечитывания журнала не проглатывается — «Ещё» скажет «Не удалось обновить журнал»', async () => {
    const { queryClient } = await import('../../src/client/lib/query');
    const { refreshOperations } = await import('../../src/client/lib/journal-mutations');
    let fail = false;
    const observer = new QueryObserver(queryClient, {
      queryKey: ['journal', 992, 'q'],
      queryFn: async () => {
        if (fail) throw new Error('сбой сети');
        return 1;
      },
      retry: false,
    });
    const stop = observer.subscribe(() => undefined);
    await expect.poll(() => observer.getCurrentResult().status).toBe('success');
    fail = true;
    await expect(refreshOperations(992)).rejects.toThrow('сбой сети');
    stop();
  });
});
