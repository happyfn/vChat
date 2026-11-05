import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerAuth } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { guildRoutes } from './routes/guilds.js';
import { createSocketServer } from './socket.js';
import { initVoice } from './voice.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true, credentials: true });
  await registerAuth(app);
  await app.register(authRoutes);
  await app.register(guildRoutes);

  await initVoice();

  await app.listen({ port: PORT, host: HOST });
  createSocketServer(app.server, app);

  console.log(`vchat server listening on http://${HOST}:${PORT}`);

  const shutdown = async () => {
    console.log('shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('server failed to start', err);
  process.exit(1);
});
