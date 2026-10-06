import type { FastifyInstance } from 'fastify';
import { TEMPLATES } from '../../../templates';

export function registerTemplatesRoutes(app: FastifyInstance): void {
  app.get('/api/v1/templates', async () => ({
    templates: TEMPLATES.map((t) => ({ key: t.key, name: t.name, integrations: t.integrations, paramsUi: t.paramsUi })),
  }));
}
