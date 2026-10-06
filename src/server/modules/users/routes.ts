import type { FastifyInstance } from 'fastify';
import { userCreateSchema, userUpdateSchema } from '../../../shared/schemas/users';
import { parseId } from '../../http/params';
import type { UsersService } from './service';

export function registerUsersRoutes(app: FastifyInstance, deps: { users: UsersService }): void {
  const { users } = deps;

  app.get('/api/v1/users', async () => ({ users: users.list() }));

  app.post('/api/v1/users', async (req, reply) => {
    const body = userCreateSchema.parse(req.body);
    const created = await users.create(body, req.user!.id);
    return reply.status(201).send({ user: users.get(created.id) });
  });

  app.patch<{ Params: { id: string } }>('/api/v1/users/:id', async (req) => {
    const id = parseId(req.params.id);
    const body = userUpdateSchema.parse(req.body);
    return { user: await users.update(id, body, req.user!.id) };
  });
}
