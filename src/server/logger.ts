import path from 'node:path';
import type { FastifyServerOptions } from 'fastify';
import type { Config } from './config';

export function createLoggerOptions(config: Config): FastifyServerOptions['logger'] {
  return {
    level: 'info',
    redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
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
