import type { FastifyInstance } from 'fastify';
import { createUser, findUserByUsername, verifyPassword } from '../auth.js';

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/register', async (req, reply) => {
    const username = (req.body?.username || '').trim();
    const password = req.body?.password || '';
    if (username.length < 2 || username.length > 24) {
      return reply.code(400).send({ error: 'username must be 2-24 chars' });
    }
    if (password.length < 4) {
      return reply.code(400).send({ error: 'password must be at least 4 chars' });
    }
    if (findUserByUsername(username)) {
      return reply.code(409).send({ error: 'username already taken' });
    }
    const user = createUser(username, password);
    const token = app.jwt.sign({ id: user.id, username: user.username });
    return { token, user: { id: user.id, username: user.username } };
  });

  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    const username = (req.body?.username || '').trim();
    const password = req.body?.password || '';
    const user = findUserByUsername(username);
    if (!user || !verifyPassword(user, password)) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    const token = app.jwt.sign({ id: user.id, username: user.username });
    return { token, user: { id: user.id, username: user.username } };
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    return { user: { id: req.user.id, username: req.user.username } };
  });
}
