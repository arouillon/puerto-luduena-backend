import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { updateUserSchema } from '../schemas/index.js';

export async function usersRoutes(app: FastifyInstance) {

  // ─── GET /users/me ───────────────────────────
  app.get('/users/me', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        dni: true,
        role: true,
        isVerified: true,
        createdAt: true,
      },
    });

    if (!user) return reply.status(404).send({ error: 'Usuario no encontrado' });
    return reply.send(user);
  });

  // ─── PATCH /users/me ─────────────────────────
  app.patch('/users/me', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: parsed.error.flatten() });
    }

    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: parsed.data,
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        dni: true,
        role: true,
      },
    });

    return reply.send(user);
  });

  // ─── GET /users/:id (admin/operator only) ────
  app.get('/users/:id', {
    preHandler: [app.requireRole('ADMIN', 'OPERATOR', 'GATEKEEPER')],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
      select: {
        id: true,
        email: true,
        phone: true,
        firstName: true,
        lastName: true,
        dni: true,
        role: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        vesselMembers: {
          where: { status: 'ACTIVE' },
          include: { vessel: { select: { id: true, name: true, registration: true } } },
        },
      },
    });

    if (!user) return reply.status(404).send({ error: 'Usuario no encontrado' });
    return reply.send(user);
  });
}
