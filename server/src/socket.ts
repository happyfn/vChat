import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { db, getChannelForUser, isGuildMember, type MessageRow } from './db.js';
import {
  closeAllForUser,
  connectTransport,
  consumeOnTransport,
  createWebRtcTransport,
  getRouterRtpCapabilities,
  leaveVoice,
  listProducers,
  produce,
} from './voice.js';

type Presence = {
  userId: number;
  username: string;
  guildId: number | null;
  voiceChannelId: number | null;
};

const presenceBySocket = new Map<string, Presence>();
let ioRef: Server | null = null;

function broadcastGuildPresence(io: Server, guildId: number) {
  const members = [...presenceBySocket.values()].filter((p) => p.guildId === guildId);
  io.to(`guild:${guildId}`).emit('presence:update', { members });
}

export function notifyGuildRefresh(guildId: number) {
  ioRef?.to(`guild:${guildId}`).emit('guild:refresh', { guildId });
}

export function createSocketServer(httpServer: HttpServer, app: FastifyInstance) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });
  ioRef = io;

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('unauthorized'));
      const user = app.jwt.verify<{ id: number; username: string }>(token);
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as { id: number; username: string };
    console.log(`socket connected user=${user.username} id=${user.id}`);

    presenceBySocket.set(socket.id, {
      userId: user.id,
      username: user.username,
      guildId: null,
      voiceChannelId: null,
    });

    socket.on('guild:join', (payload: { guildId: number }, ack?: (r: unknown) => void) => {
      const guildId = Number(payload?.guildId);
      if (!isGuildMember(guildId, user.id)) {
        ack?.({ error: 'forbidden' });
        return;
      }
      const prev = presenceBySocket.get(socket.id);
      if (prev?.guildId) socket.leave(`guild:${prev.guildId}`);
      socket.join(`guild:${guildId}`);
      presenceBySocket.set(socket.id, {
        userId: user.id,
        username: user.username,
        guildId,
        voiceChannelId: prev?.voiceChannelId ?? null,
      });
      broadcastGuildPresence(io, guildId);
      ack?.({ ok: true });
    });

    socket.on('channel:join', (payload: { channelId: number }, ack?: (r: unknown) => void) => {
      const channelId = Number(payload?.channelId);
      const channel = getChannelForUser(channelId, user.id);
      if (!channel) {
        ack?.({ error: 'forbidden' });
        return;
      }
      socket.join(`channel:${channelId}`);
      ack?.({ ok: true });
    });

    socket.on(
      'message:send',
      (payload: { channelId: number; content: string }, ack?: (r: unknown) => void) => {
        const channelId = Number(payload?.channelId);
        const content = (payload?.content || '').trim();
        if (!content || content.length > 2000) {
          ack?.({ error: 'invalid content' });
          return;
        }
        const channel = getChannelForUser(channelId, user.id);
        if (!channel || channel.type !== 'text') {
          ack?.({ error: 'forbidden' });
          return;
        }
        const result = db
          .prepare('INSERT INTO messages (channel_id, user_id, content) VALUES (?, ?, ?)')
          .run(channelId, user.id, content);
        const message = db
          .prepare(
            `SELECT m.*, u.username FROM messages m
             INNER JOIN users u ON u.id = m.user_id
             WHERE m.id = ?`,
          )
          .get(result.lastInsertRowid) as MessageRow;
        io.to(`channel:${channelId}`).emit('message:new', { message });
        ack?.({ ok: true, message });
      },
    );

    socket.on('voice:join', (payload: { channelId: number }, ack?: (r: unknown) => void) => {
      const channelId = Number(payload?.channelId);
      const channel = getChannelForUser(channelId, user.id);
      if (!channel || channel.type !== 'voice') {
        ack?.({ error: 'forbidden' });
        return;
      }
      const prev = presenceBySocket.get(socket.id);
      if (prev?.voiceChannelId && prev.voiceChannelId !== channelId) {
        leaveVoice(prev.voiceChannelId, user.id);
        socket.leave(`voice:${prev.voiceChannelId}`);
        io.to(`voice:${prev.voiceChannelId}`).emit('voice:peerLeft', { userId: user.id });
      }
      socket.join(`voice:${channelId}`);
      presenceBySocket.set(socket.id, {
        userId: user.id,
        username: user.username,
        guildId: prev?.guildId ?? channel.guild_id,
        voiceChannelId: channelId,
      });
      if (prev?.guildId) broadcastGuildPresence(io, prev.guildId);
      else broadcastGuildPresence(io, channel.guild_id);

      const peers = [...presenceBySocket.values()]
        .filter((p) => p.voiceChannelId === channelId)
        .map((p) => ({ userId: p.userId, username: p.username }));
      io.to(`voice:${channelId}`).emit('voice:peers', { peers });
      ack?.({ ok: true, peers, producers: listProducers(channelId, user.id) });
    });

    socket.on('voice:leave', async (_payload, ack?: (r: unknown) => void) => {
      const prev = presenceBySocket.get(socket.id);
      if (prev?.voiceChannelId) {
        const channelId = prev.voiceChannelId;
        leaveVoice(channelId, user.id);
        socket.leave(`voice:${channelId}`);
        presenceBySocket.set(socket.id, { ...prev, voiceChannelId: null });
        io.to(`voice:${channelId}`).emit('voice:peerLeft', { userId: user.id });
        if (prev.guildId) broadcastGuildPresence(io, prev.guildId);
      }
      ack?.({ ok: true });
    });

    socket.on('voice:getRouterRtpCapabilities', async (payload: { channelId: number }, ack) => {
      try {
        const channelId = Number(payload.channelId);
        const channel = getChannelForUser(channelId, user.id);
        if (!channel || channel.type !== 'voice') throw new Error('forbidden');
        const rtpCapabilities = await getRouterRtpCapabilities(channelId);
        ack?.({ rtpCapabilities });
      } catch (err) {
        ack?.({ error: (err as Error).message });
      }
    });

    socket.on('voice:createTransport', async (payload: { channelId: number }, ack) => {
      try {
        const channelId = Number(payload.channelId);
        const channel = getChannelForUser(channelId, user.id);
        if (!channel || channel.type !== 'voice') throw new Error('forbidden');
        const transport = await createWebRtcTransport(channelId, user.id);
        ack?.({ transport });
      } catch (err) {
        ack?.({ error: (err as Error).message });
      }
    });

    socket.on(
      'voice:connectTransport',
      async (payload: { channelId: number; transportId: string; dtlsParameters: unknown }, ack) => {
        try {
          await connectTransport(
            Number(payload.channelId),
            user.id,
            payload.transportId,
            payload.dtlsParameters as never,
          );
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ error: (err as Error).message });
        }
      },
    );

    socket.on(
      'voice:produce',
      async (
        payload: {
          channelId: number;
          transportId: string;
          kind: 'audio' | 'video';
          rtpParameters: unknown;
        },
        ack,
      ) => {
        try {
          const channelId = Number(payload.channelId);
          const result = await produce(
            channelId,
            user.id,
            payload.transportId,
            payload.kind,
            payload.rtpParameters as never,
          );
          socket.to(`voice:${channelId}`).emit('voice:newProducer', {
            userId: user.id,
            producerId: result.id,
          });
          ack?.({ id: result.id });
        } catch (err) {
          ack?.({ error: (err as Error).message });
        }
      },
    );

    socket.on(
      'voice:consume',
      async (
        payload: {
          channelId: number;
          transportId: string;
          producerId: string;
          rtpCapabilities: unknown;
        },
        ack,
      ) => {
        try {
          const consumer = await consumeOnTransport(
            Number(payload.channelId),
            user.id,
            payload.transportId,
            payload.producerId,
            payload.rtpCapabilities as never,
          );
          ack?.({ consumer });
        } catch (err) {
          ack?.({ error: (err as Error).message });
        }
      },
    );

    socket.on('disconnect', () => {
      const prev = presenceBySocket.get(socket.id);
      presenceBySocket.delete(socket.id);
      if (prev?.voiceChannelId) {
        leaveVoice(prev.voiceChannelId, user.id);
        io.to(`voice:${prev.voiceChannelId}`).emit('voice:peerLeft', { userId: user.id });
      }
      closeAllForUser(user.id);
      if (prev?.guildId) broadcastGuildPresence(io, prev.guildId);
      console.log(`socket disconnected user=${user.username}`);
    });
  });

  return io;
}
