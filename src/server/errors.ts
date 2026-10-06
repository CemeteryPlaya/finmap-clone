import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({
        error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) },
      });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'Проверьте заполнение полей', fields: zodFields(err) },
      });
    }
    const status = (err as FastifyError).statusCode;
    if (status === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Слишком много запросов, повторите позже' } });
    }
    if (status === 413) {
      // лимит 10 МБ есть только у загрузки вложений; остальным маршрутам — общий лимит тела запроса
      const upload = req.routeOptions.url?.endsWith('/attachments') ?? false;
      return reply.status(413).send({ error: { code: 'TOO_LARGE', message: upload ? 'Файл больше 10 МБ' : 'Слишком большой запрос' } });
    }
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    req.log.error({ err }, 'Необработанная ошибка');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } });
  });
}
