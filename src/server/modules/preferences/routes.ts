import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import type { PreferencesService } from './service';

/** Значение — любой JSON, включая null; отсутствие поля value — ошибка. */
function readValue(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('value' in body) || body.value === undefined) {
    throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { value: 'Укажите значение' });
  }
  return body.value;
}

export function registerPreferencesRoutes(app: FastifyInstance, deps: { preferences: PreferencesService }): void {
  app.get('/api/v1/preferences', async (req) => ({ preferences: deps.preferences.all(req.user!.id) }));

  app.put<{ Params: { key: string } }>('/api/v1/preferences/:key', async (req) => {
    const value = readValue(req.body);
    deps.preferences.set(req.user!.id, req.params.key, value);
    return { key: req.params.key, value };
  });
}
