import { describe, expect, it } from 'vitest';
import { scheduledJobs } from '../../src/server/main';

/** Задачи планировщика локального режима (план 2026-11-02-senet-autopost, задача 7). */
describe('scheduledJobs', () => {
  it('бэкап в 04:00, забор Senet в 5 минут каждого часа, уборка сырых файлов Senet ночью', async () => {
    const calls: unknown[] = [];
    const jobs = scheduledJobs({
      backup: async () => void calls.push('backup'),
      senetSync: async (o) => void calls.push(o),
      senetCleanup: async () => void calls.push('cleanup'),
    });
    expect(jobs.map((j) => [j.name, j.cron])).toEqual([
      ['daily-backup', '0 4 * * *'],
      ['senet-sync', '5 * * * *'],
      ['senet-cleanup', '30 4 * * *'],
    ]);
    for (const j of jobs) await j.run();
    expect(calls).toEqual(['backup', { trigger: 'hourly' }, 'cleanup']);
  });
});
