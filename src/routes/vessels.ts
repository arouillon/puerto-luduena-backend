import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { createVesselSchema, updateVesselSchema, paginationSchema } from '../schemas/index.js';

export async function vesselsRoutes(app: FastifyInstance) {

  // ─── GET /vessels (mis embarcaciones) ────────
  app.get('/vessels', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { page, limit } = paginationSchema.parse(request.query);

    // Admin ve todas, otros ven solo las suyas
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

  // ─── POST /vessels ───────────────────────────
  app.post('/vessels', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createVesselSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: parsed.error.flatten() });
    }

    // Verificar matrícula única
    const existing = await prisma.vessel.findUnique({ where: { registration: parsed.data.registration } });
    if (existing) return reply.status(409).send({ error: 'Ya existe una embarcación con esa matrícula' });

    const vessel = await prisma.vessel.create({
      data: {
        ...parsed.data,
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

  // ─── PATCH /vessels/:id ──────────────────────
  app.patch('/vessels/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const parsed = updateVesselSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: parsed.error.flatten() });
    }

    // Verificar que es miembro activo o admin
    const isAdmin = request.user.role === 'ADMIN';
    if (!isAdmin) {
      const member = await prisma.vesselMember.findFirst({
        where: { vesselId: request.params.id, userId: request.user.sub, status: 'ACTIVE' },
      });
      if (!member) return reply.status(403).send({ error: 'No sos co-propietario de esta embarcación' });
    }

    const vessel = await prisma.vessel.update({
      where: { id: request.params.id },
      data: parsed.data,
    });

    return reply.send(vessel);
  });

  // ─── POST /vessels/:id/members (invitar co-propietario) ──
  app.post('/vessels/:id/members', { preHandler: [app.authenticate] }, async (request: FastifyRequest<{
    Params: { id: string };
    Body: { email?: string; phone?: string };
  }>, reply: FastifyReply) => {
    const { id: vesselId } = request.params;
    const { email, phone } = request.body as { email?: string; phone?: string };

    if (!email && !phone) {
      return reply.status(400).send({ error: 'Se requiere email o teléfono del invitado' });
    }

    // Verificar que el invitante es miembro activo
    const inviterMember = await prisma.vesselMember.findFirst({
      where: { vesselId, userId: request.user.sub, status: 'ACTIVE' },
    });
    if (!inviterMember && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'No sos co-propietario de esta embarcación' });
    }

    // Verificar límite de co-propietarios
    const config = await prisma.systemConfig.findUnique({ where: { key: 'MAX_VESSEL_MEMBERS' } });
    const maxMembers = config ? parseInt(config.value) : 6;
    const currentCount = await prisma.vesselMember.count({ where: { vesselId, status: 'ACTIVE' } });
    if (currentCount >= maxMembers) {
      return reply.status(400).send({ error: `Límite de ${maxMembers} co-propietarios alcanzado` });
    }

    // Buscar usuario invitado
    let invitedUser;
    if (email) {
      invitedUser = await prisma.user.findUnique({ where: { email } });
    } else if (phone) {
      invitedUser = await prisma.user.findUnique({ where: { phone } });
    }

    if (!invitedUser) {
      return reply.status(404).send({ error: 'Usuario no encontrado. Debe registrarse primero.' });
    }

    // Verificar que no sea ya miembro
    const existingMember = await prisma.vesselMember.findUnique({
      where: { userId_vesselId: { userId: invitedUser.id, vesselId } },
    });
    if (existingMember && existingMember.status === 'ACTIVE') {
      return reply.status(409).send({ error: 'Ya es co-propietario' });
    }

    // Crear o actualizar membresía
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

  // ─── PATCH /vessels/:id/members/:uid/accept ──
  app.patch('/vessels/:id/members/accept', { preHandler: [app.authenticate] }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const member = await prisma.vesselMember.findFirst({
      where: { vesselId: request.params.id, userId: request.user.sub, status: 'PENDING' },
    });

    if (!member) return reply.status(404).send({ error: 'No tenés invitación pendiente para esta embarcación' });

    const updated = await prisma.vesselMember.update({
      where: { id: member.id },
      data: { status: 'ACTIVE', acceptedAt: new Date() },
    });

    return reply.send(updated);
  });

  // ─── DELETE /vessels/:id/members/:uid ────────
  app.delete('/vessels/:id/members/:uid', { preHandler: [app.authenticate] }, async (request: FastifyRequest<{
    Params: { id: string; uid: string };
  }>, reply: FastifyReply) => {
    const { id: vesselId, uid: userId } = request.params;

    // Solo el admin o el propio usuario pueden revocar
    if (request.user.sub !== userId && request.user.role !== 'ADMIN') {
      // Verificar que el que revoca es co-propietario
      const revokerMember = await prisma.vesselMember.findFirst({
        where: { vesselId, userId: request.user.sub, status: 'ACTIVE' },
      });
      if (!revokerMember) return reply.status(403).send({ error: 'No tenés permisos' });
    }

    const member = await prisma.vesselMember.findFirst({
      where: { vesselId, userId, status: { in: ['ACTIVE', 'PENDING'] } },
    });

    if (!member) return reply.status(404).send({ error: 'Membresía no encontrada' });

    await prisma.vesselMember.update({
      where: { id: member.id },
      data: { status: 'REVOKED' },
    });

    return reply.send({ message: 'Membresía revocada' });
  });
}
