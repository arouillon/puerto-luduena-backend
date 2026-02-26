import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { updateUserRoleSchema, updateConfigSchema, paginationSchema } from '../schemas/index.js';

export async function adminRoutes(app: FastifyInstance) {

  // ─── GET /admin/stats ────────────────────────
  app.get('/admin/stats', {
    preHandler: [app.requireRole('ADMIN')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      totalUsers,
      totalVessels,
      todayReservations,
      insideNow,
      activeReservations,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.vessel.count({ where: { deletedAt: null } }),
      prisma.reservation.count({
        where: { estimatedArrival: { gte: today, lt: tomorrow }, status: { not: 'CANCELLED' } },
      }),
      prisma.accessLog.count({ where: { direction: 'ENTRY', exitedAt: null } }),
      prisma.reservation.count({ where: { status: { in: ['PENDING', 'CONFIRMED', 'IN_WATER'] } } }),
    ]);

    return reply.send({
      totalUsers,
      totalVessels,
      todayReservations,
      insideNow,
      activeReservations,
    });
  });

  // ─── GET /admin/users ────────────────────────
  app.get('/admin/users', {
    preHandler: [app.requireRole('ADMIN')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { page, limit } = paginationSchema.parse(request.query);

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          isVerified: true,
          createdAt: true,
          _count: { select: { vesselMembers: true, reservations: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where: { deletedAt: null } }),
    ]);

    return reply.send({ data: users, total, page, limit });
  });

  // ─── PATCH /admin/users/:id ──────────────────
  app.patch('/admin/users/:id', {
    preHandler: [app.requireRole('ADMIN')],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const parsed = updateUserRoleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: parsed.error.flatten() });
    }

    const user = await prisma.user.update({
      where: { id: request.params.id },
      data: parsed.data,
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });

    return reply.send(user);
  });

  // ─── GET /admin/config ───────────────────────
  app.get('/admin/config', {
    preHandler: [app.requireRole('ADMIN')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const configs = await prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });
    return reply.send(configs);
  });

  // ─── PATCH /admin/config/:key ────────────────
  app.patch('/admin/config/:key', {
    preHandler: [app.requireRole('ADMIN')],
  }, async (request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
    const parsed = updateConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos inválidos' });
    }

    const config = await prisma.systemConfig.update({
      where: { key: request.params.key },
      data: { value: parsed.data.value, updatedBy: request.user.sub },
    });

    return reply.send(config);
  });

  // ─── GET /admin/operators/stats ──────────────
  app.get('/admin/operators/stats', {
    preHandler: [app.requireRole('ADMIN')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const operators = await prisma.user.findMany({
      where: { role: 'OPERATOR', isActive: true, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        _count: { select: { botados: true } },
        botados: {
          select: { responseTimeSec: true },
          where: { responseTimeSec: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    const stats = operators.map(op => {
      const avgResponse = op.botados.length > 0
        ? Math.round(op.botados.reduce((sum, b) => sum + (b.responseTimeSec ?? 0), 0) / op.botados.length)
        : null;

      return {
        id: op.id,
        name: `${op.firstName} ${op.lastName}`,
        totalBotados: op._count.botados,
        avgResponseTimeSec: avgResponse,
      };
    });

    return reply.send(stats);
  });
}
