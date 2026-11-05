import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { db, type UserRow } from './db.js';

export type JwtUser = {
  id: number;
  username: string;
};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

export async function registerAuth(app: FastifyInstance) {
  await app.register((await import('@fastify/jwt')).default, {
    secret: process.env.JWT_SECRET || 'vchat-dev-secret-change-me',
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function findUserByUsername(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}

export function createUser(username: string, password: string): UserRow {
  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, passwordHash);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as UserRow;
}

export function verifyPassword(user: UserRow, password: string): boolean {
  return bcrypt.compareSync(password, user.password_hash);
}
