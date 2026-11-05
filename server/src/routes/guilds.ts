import type { FastifyInstance } from 'fastify';
import { customAlphabet } from 'nanoid';
import { db, isGuildMember, type ChannelRow, type GuildRow, type MessageRow } from '../db.js';
import { notifyGuildRefresh } from '../socket.js';

const inviteCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

function listGuildsForUser(userId: number) {
  return db
    .prepare(
      `SELECT g.* FROM guilds g
       INNER JOIN guild_members m ON m.guild_id = g.id
       WHERE m.user_id = ?
       ORDER BY g.id ASC`,
    )
    .all(userId) as GuildRow[];
}

function listChannels(guildId: number) {
  return db
    .prepare('SELECT * FROM channels WHERE guild_id = ? ORDER BY position ASC, id ASC')
    .all(guildId) as ChannelRow[];
}

function listMembers(guildId: number) {
  return db
    .prepare(
      `SELECT u.id, u.username FROM users u
       INNER JOIN guild_members m ON m.user_id = u.id
       WHERE m.guild_id = ?
       ORDER BY u.username COLLATE NOCASE ASC`,
    )
    .all(guildId) as { id: number; username: string }[];
}

function createGuildWithDefaults(name: string, ownerId: number): GuildRow {
  const code = inviteCode();
  const create = db.transaction(() => {
    const result = db
      .prepare('INSERT INTO guilds (name, owner_id, invite_code) VALUES (?, ?, ?)')
      .run(name, ownerId, code);
    const guildId = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO guild_members (guild_id, user_id) VALUES (?, ?)').run(guildId, ownerId);
    db.prepare(
      `INSERT INTO channels (guild_id, name, type, position) VALUES
       (?, '大厅', 'text', 0),
       (?, '语音大厅', 'voice', 1)`,
    ).run(guildId, guildId);
    return db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId) as GuildRow;
  });
  return create();
}

export async function guildRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/guilds', async (req) => {
    return { guilds: listGuildsForUser(req.user.id) };
  });

  app.post<{ Body: { name?: string } }>('/api/guilds', async (req, reply) => {
    const name = (req.body?.name || '').trim();
    if (name.length < 1 || name.length > 40) {
      return reply.code(400).send({ error: 'name must be 1-40 chars' });
    }
    const guild = createGuildWithDefaults(name, req.user.id);
    return { guild, channels: listChannels(guild.id) };
  });

  app.post<{ Body: { code?: string } }>('/api/guilds/join', async (req, reply) => {
    const code = (req.body?.code || '').trim().toUpperCase();
    const guild = db.prepare('SELECT * FROM guilds WHERE invite_code = ?').get(code) as GuildRow | undefined;
    if (!guild) return reply.code(404).send({ error: 'invite not found' });
    db.prepare(
      'INSERT OR IGNORE INTO guild_members (guild_id, user_id) VALUES (?, ?)',
    ).run(guild.id, req.user.id);
    notifyGuildRefresh(guild.id);
    return { guild, channels: listChannels(guild.id) };
  });

  app.get<{ Params: { guildId: string } }>('/api/guilds/:guildId', async (req, reply) => {
    const guildId = Number(req.params.guildId);
    if (!isGuildMember(guildId, req.user.id)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId) as GuildRow | undefined;
    if (!guild) return reply.code(404).send({ error: 'not found' });
    return {
      guild,
      channels: listChannels(guildId),
      members: listMembers(guildId),
    };
  });

  app.get<{ Params: { channelId: string }; Querystring: { before?: string; limit?: string } }>(
    '/api/channels/:channelId/messages',
    async (req, reply) => {
      const channelId = Number(req.params.channelId);
      const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId) as ChannelRow | undefined;
      if (!channel || channel.type !== 'text') {
        return reply.code(404).send({ error: 'channel not found' });
      }
      if (!isGuildMember(channel.guild_id, req.user.id)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
      const messages = db
        .prepare(
          `SELECT m.*, u.username FROM messages m
           INNER JOIN users u ON u.id = m.user_id
           WHERE m.channel_id = ? AND m.id < ?
           ORDER BY m.id DESC
           LIMIT ?`,
        )
        .all(channelId, before, limit) as MessageRow[];
      return { messages: messages.reverse() };
    },
  );
}
