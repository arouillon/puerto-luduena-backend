import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { createVesselSchema, updateVesselSchema, paginationSchema } from '../schemas/index.js';

export async function vesselsRoutes(app: FastifyInstance) {

  // GET /vessels
  app.get('/vessels', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { page, limit } = paginationSchema.parse(request.query);
    const isAdmin = request.user.role === 'ADMIN';

    const where = isAdmin
      ? {}
      : { members: { some: { userId: request.user.sub, status: 'ACTIVE' as const } } };

    const [vessels, total] = await Promise.all([
      prisma.vessel.findMany({
        where,
        include: {
          members: {
            where: { status: 'ACTIVE' },
            include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
          },
          documents: { where: { deletedAt: null }, select: { id: true, type: true, status: true, expiresAt: true } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      prisma.vessel.count({ where }),
    ]);

    return reply.send({ data: vessels, total, page, limit });
  });

  // POST /vessels
  app.post('/vessels', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createVesselSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos invalidos', details: parsed.error.flatten() });
    }

    const existing = await prisma.vessel.findUnique({ where: { registration: parsed.data.registration } });
    if (existing) return reply.status(409).send({ error: 'Ya existe una embarcacion con esa matricula' });

    const vessel = await prisma.vessel.create({
      data: {
        name: parsed.data.name,
        registration: parsed.data.registration,
        type: parsed.data.type,
        brand: parsed.data.brand || null,
        model: parsed.data.model || null,
        year: parsed.data.year || null,
        berth: parsed.data.berth || null,
        mooringZone: parsed.data.mooringZone || null,
        members: {
          create: {
            userId: request.user.sub,
            status: 'ACTIVE',
            acceptedAt: new Date(),
          },
        },
      },
      include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } },
    });

    return reply.status(201).send(vessel);
  });

  // PATCH /vessels/:id
  app.patch('/vessels/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    const parsed = updateVesselSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos invalidos', details: parsed.error.flatten() });
    }

    const isAdmin = request.user.role === 'ADMIN';
    if (!isAdmin) {
      const member = await prisma.vesselMember.findFirst({
        where: { vesselId: params.id, userId: request.user.sub, status: 'ACTIVE' },
      });
      if (!member) return reply.status(403).send({ error: 'No sos co-propietario de esta embarcacion' });
    }

    const vessel = await prisma.vessel.update({
      where: { id: params.id },
      data: parsed.data as any,
    });

    return reply.send(vessel);
  });

  // POST /vessels/:id/members
  app.post('/vessels/:id/members', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    const body = request.body as { email?: string; phone?: string };
    const vesselId = params.id;

    if (!body.email && !body.phone) {
      return reply.status(400).send({ error: 'Se requiere email o telefono del invitado' });
    }

    const inviterMember = await prisma.vesselMember.findFirst({
      where: { vesselId, userId: request.user.sub, status: 'ACTIVE' },
    });
    if (!inviterMember && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'No sos co-propietario de esta embarcacion' });
    }

    const config = await prisma.systemConfig.findUnique({ where: { key: 'MAX_VESSEL_MEMBERS' } });
    const maxMembers = config ? parseInt(config.value) : 6;
    const currentCount = await prisma.vesselMember.count({ where: { vesselId, status: 'ACTIVE' } });
    if (currentCount >= maxMembers) {
      return reply.status(400).send({ error: 'Limite de ' + maxMembers + ' co-propietarios alcanzado' });
    }

    let invitedUser: any = null;
    if (body.email) {
      invitedUser = await prisma.user.findUnique({ where: { email: body.email } });
    } else if (body.phone) {
      invitedUser = await prisma.user.findUnique({ where: { phone: body.phone } });
    }

    if (!invitedUser) {
      return reply.status(404).send({ error: 'Usuario no encontrado. Debe registrarse primero.' });
    }

    const existingMember = await prisma.vesselMember.findUnique({
      where: { userId_vesselId: { userId: invitedUser.id, vesselId } },
    });
    if (existingMember && existingMember.status === 'ACTIVE') {
      return reply.status(409).send({ error: 'Ya es co-propietario' });
    }

    const member = existingMember
      ? await prisma.vesselMember.update({
          where: { id: existingMember.id },
          data: { status: 'PENDING', invitedBy: request.user.sub, invitedAt: new Date() },
        })
      : await prisma.vesselMember.create({
          data: {
            userId: invitedUser.id,
            vesselId,
            status: 'PENDING',
            invitedBy: request.user.sub,
            invitedAt: new Date(),
          },
        });

    return reply.status(201).send(member);
  });

  // PATCH /vessels/:id/members/accept
  app.patch('/vessels/:id/members/accept', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    const member = await prisma.vesselMember.findFirst({
      where: { vesselId: params.id, userId: request.user.sub, status: 'PENDING' },
    });

    if (!member) return reply.status(404).send({ error: 'No tenes invitacion pendiente para esta embarcacion' });

    const updated = await prisma.vesselMember.update({
      where: { id: member.id },
      data: { status: 'ACTIVE', acceptedAt: new Date() },
    });

    return reply.send(updated);
  });

  // DELETE /vessels/:id/members/:uid
  app.delete('/vessels/:id/members/:uid', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string; uid: string };
    const vesselId = params.id;
    const userId = params.uid;

    if (request.user.sub !== userId && request.user.role !== 'ADMIN') {
      const revokerMember = await prisma.vesselMember.findFirst({
        where: { vesselId, userId: request.user.sub, status: 'ACTIVE' },
      });
      if (!revokerMember) return reply.status(403).send({ error: 'No tenes permisos' });
    }

    const member = await prisma.vesselMember.findFirst({
      where: { vesselId, userId, status: { in: ['ACTIVE', 'PENDING'] } },
    });

    if (!member) return reply.status(404).send({ error: 'Membresia no encontrada' });

    await prisma.vesselMember.update({
      where: { id: member.id },
      data: { status: 'REVOKED' },
    });

    return reply.send({ message: 'Membresia revocada' });
  });
}
