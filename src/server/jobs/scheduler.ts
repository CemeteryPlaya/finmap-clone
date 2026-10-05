import { Cron } from 'croner';

export interface Job {
  name: string;
  cron: string;
  run(): void | Promise<void>;
}

export function startScheduler(o: {
  timezone: string;
  jobs: Job[];
  log: (msg: string, err?: unknown) => void;
}): { stop(): void } {
  const crons = o.jobs.map(
    (job) =>
      new Cron(job.cron, { timezone: o.timezone, protect: true }, async () => {
        try {
          await job.run();
        } catch (e) {
          o.log(`Задача «${job.name}» завершилась с ошибкой`, e);
        }
      }),
  );
  return { stop: () => crons.forEach((c) => c.stop()) };
}
