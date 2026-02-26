import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../lib/prisma.js';
import { createAuthorizationSchema } from '../schemas/index.js';

export async function authorizationsRoutes(app: FastifyInstance) {

  // ─── POST /authorizations ────────────────────
  app.post('/authorizations', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createAuthorizationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: parsed.error.flatten() });
    }

    const data = parsed.data;

    // Verificar que el usuario es co-propietario activo
    const member = await prisma.vesselMember.findFirst({
      where: { vesselId: data.vesselId, userId: request.user.sub, status: 'ACTIVE' },
    });
    if (!member && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'No sos co-propietario de esta embarcación' });
    }

    // Buscar si el autorizado ya tiene cuenta
    let grantedToId: string | null = null;
    if (data.granteeEmail) {
      const user = await prisma.user.findUnique({ where: { email: data.granteeEmail } });
      if (user) grantedToId = user.id;
    } else if (data.granteePhone) {
      const user = await prisma.user.findUnique({ where: { phone: data.granteePhone } });
      if (user) grantedToId = user.id;
    }

    const authorization = await prisma.authorization.create({
      data: {
        vesselId: data.vesselId,
        grantedBy: request.user.sub,
        grantedTo: grantedToId,
        granteeEmail: data.granteeEmail,
        granteePhone: data.granteePhone,
        granteeName: data.granteeName,
        type: data.type,
        purpose: data.purpose,
        validFrom: new Date(data.validFrom),
        validUntil: new Date(data.validUntil),
      },
      include: {
        vessel: { select: { id: true, name: true } },
      },
    });

    // Notificar co-propietarios
    const members = await prisma.vesselMember.findMany({
      where: { vesselId: data.vesselId, status: 'ACTIVE' },
    });

    await prisma.notification.createMany({
      data: members.map(m => ({
        userId: m.userId,
        type: 'AUTHORIZATION_CREATED' as const,
        title: 'Nueva autorización',
        body: `${data.granteeName} fue autorizado como ${data.type === 'NAVIGATOR' ? 'navegante' : 'técnico'}`,
        data: { authorizationId: authorization.id },
      })),
    });

    return reply.status(201).send(authorization);
  });

  // ─── GET /authorizations/vessel/:id ──────────
  app.get('/authorizations/vessel/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest<{
    Params: { id: string };
  }>, reply: FastifyReply) => {
    const authorizations = await prisma.authorization.findMany({
      where: { vesselId: request.params.id, revokedAt: null },
      include: {
        granter: { select: { id: true, firstName: true, lastName: true } },
        grantee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { validFrom: 'desc' },
    });

    return reply.send(authorizations);
  });

  // ─── DELETE /authorizations/:id ──────────────
  app.delete('/authorizations/:id', { preHandler: [app.authenticate] }, async (request: FastifyRequest<{
    Params: { id: string };
  }>, reply: FastifyReply) => {
    const auth = await prisma.authorization.findUnique({ where: { id: request.params.id } });
    if (!auth) return reply.status(404).send({ error: 'Autorización no encontrada' });
    if (auth.revokedAt) return reply.status(400).send({ error: 'Ya fue revocada' });

    // Verificar permisos
    const isMember = await prisma.vesselMember.findFirst({
      where: { vesselId: auth.vesselId, userId: request.user.sub, status: 'ACTIVE' },
    });
    if (!isMember && request.user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'No tenés permisos' });
    }

    await prisma.authorization.update({
      where: { id: request.params.id },
      data: { revokedAt: new Date(), revokedBy: request.user.sub },
    });

    return reply.send({ message: 'Autorización revocada' });
  });
}
