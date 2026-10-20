import path from 'node:path';
import type { FastifyServerOptions } from 'fastify';
import type { Config } from './config';

const REDACT = ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'];

export function createLoggerOptions(config: Config): FastifyServerOptions['logger'] {
  // на Vercel журнал — stdout (его собирает Vercel); файлов и pretty нет
  if (config.deployMode === 'vercel') return { level: 'info', redact: REDACT };
  return {
    level: 'info',
    redact: REDACT,
    transport: {
      targets: [
        { target: 'pino-pretty', options: { translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname' } },
        {
          target: 'pino-roll',
          options: { file: path.join(config.logsDir, 'app'), size: '10m', limit: { count: 7 }, mkdir: true, extension: '.log' },
        },
      ],
    },
  };
}
