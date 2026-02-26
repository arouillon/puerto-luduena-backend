import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { broadcastSchema, paginationSchema } from '../schemas/index.js';

export async function notificationsRoutes(app: FastifyInstance) {

  // ─── GET /notifications/me ───────────────────
  app.get('/notifications/me', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { page, limit } = paginationSchema.parse(request.query);

    const [notifications, total, unread] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: request.user.sub },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where: { userId: request.user.sub } }),
      prisma.notification.count({ where: { userId: request.user.sub, isRead: false } }),
    ]);

    return reply.send({ data: notifications, total, unread, page, limit });
  });

  // ─── PATCH /notifications/:id/read ───────────
  app.patch('/notifications/:id/read', { preHandler: [app.authenticate] }, async (request: FastifyRequest<{
    Params: { id: string };
  }>, reply: FastifyReply) => {
    const notification = await prisma.notification.findFirst({
      where: { id: request.params.id, userId: request.user.sub },
    });

    if (!notification) return reply.status(404).send({ error: 'Notificación no encontrada' });

    const updated = await prisma.notification.update({
      where: { id: request.params.id },
      data: { isRead: true, readAt: new Date() },
    });

    return reply.send(updated);
  });

  // ─── POST /notifications/broadcast (admin) ───
  app.post('/notifications/broadcast', {
    preHandler: [app.requireRole('ADMIN', 'OPERATOR')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = broadcastSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: parsed.error.flatten() });
    }

    const { title, body } = parsed.data;

    // Obtener todos los usuarios activos
    const users = await prisma.user.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });

    await prisma.notification.createMany({
      data: users.map(u => ({
        userId: u.id,
        type: 'BROADCAST' as const,
        title,
        body,
      })),
    });

    return reply.send({ message: `Broadcast enviado a ${users.length} usuarios` });
  });
}
