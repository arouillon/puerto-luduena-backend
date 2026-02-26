import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { usersRoutes } from './routes/users.js';
import { vesselsRoutes } from './routes/vessels.js';
import { reservationsRoutes } from './routes/reservations.js';
import { accessRoutes } from './routes/access.js';
import { botadoRoutes } from './routes/botado.js';
import { notificationsRoutes } from './routes/notifications.js';
import { authorizationsRoutes } from './routes/authorizations.js';
import { documentsRoutes } from './routes/documents.js';
import { adminRoutes } from './routes/admin.js';

async function start() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  await app.register(cors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(usersRoutes);
  await app.register(vesselsRoutes);
  await app.register(reservationsRoutes);
  await app.register(accessRoutes);
  await app.register(botadoRoutes);
  await app.register(notificationsRoutes);
  await app.register(authorizationsRoutes);
  await app.register(documentsRoutes);
  await app.register(adminRoutes);

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  const PORT = parseInt(process.env.PORT || '3000');
  const HOST = process.env.HOST || '0.0.0.0';

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log('Puerto Luduena API corriendo en http://' + HOST + ':' + PORT);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
